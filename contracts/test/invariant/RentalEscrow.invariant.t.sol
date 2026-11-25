// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowFactory} from "../../src/EscrowFactory.sol";
import {RentalEscrow} from "../../src/RentalEscrow.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";

/// @dev Drives one funded escrow with random calls from a configurable set of actors and random time jumps.
/// Every call is made by a real role address (vm.prank); reverts are expected and swallowed. Ghost variables
/// record every token that left the escrow and who had acted, so the invariants can check where money went.
contract EscrowHandler is Test {
    RentalEscrow public immutable escrow;
    MockUSDT public immutable usdt;
    address public immutable landlord;
    address public immutable tenant;
    address public immutable arbiter;
    address public immutable treasury;
    address[] public actors;

    uint256 public tenantIn; // everything the tenant paid into the escrow (fund + payRent)
    uint256 public tenantOut; // everything the escrow paid back to the tenant
    uint256 public landlordOut; // everything paid to the payee (rent net of fee + deposit claim)
    uint256 public feeOut;
    uint256 public landlordClaim; // the part of the deposit that went to the landlord
    uint256 public tenantRefund; // the part of the deposit that went back to the tenant
    uint32 public maxDueSeen; // highest monthsDue() observed at any payout
    uint32 public tenantEarlyRelease; // highest monthsFunded the tenant released early
    bool public settled;
    uint32 public dueAtSettle; // monthsDue() when the lease settled
    bytes4 public settledBy; // selector of the call that settled the lease
    address public settledCaller;
    bool public tenantActed; // the tenant made a successful propose/accept
    bool public arbiterActed; // the arbiter made a successful resolve
    uint256 public calls;

    constructor(RentalEscrow escrow_, MockUSDT usdt_, address treasury_, address[] memory actors_) {
        escrow = escrow_;
        usdt = usdt_;
        RentalEscrow.Terms memory t = escrow_.terms();
        landlord = t.landlord;
        tenant = t.tenant;
        arbiter = t.arbiter;
        treasury = treasury_;
        actors = actors_;
        tenantIn = t.depositAmount + t.rentAmount; // funded in setUp
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _has(address who) internal view returns (bool) {
        for (uint256 i; i < actors.length; ++i) {
            if (actors[i] == who) return true;
        }
        return false;
    }

    /// @dev Runs a call as `who` and books every balance change it caused.
    function _run(address who, bytes memory data) internal returns (bool ok) {
        ++calls;
        uint256 t0 = usdt.balanceOf(tenant);
        uint256 l0 = usdt.balanceOf(landlord);
        uint256 f0 = usdt.balanceOf(treasury);
        uint32 due = escrow.monthsDue();
        bool wasSettled = escrow.status() == RentalEscrow.Status.Settled;

        vm.prank(who);
        (ok,) = address(escrow).call(data);
        if (!ok) return false;

        uint256 t1 = usdt.balanceOf(tenant);
        if (t1 < t0) tenantIn += t0 - t1;
        else tenantOut += t1 - t0;
        landlordOut += usdt.balanceOf(landlord) - l0;
        feeOut += usdt.balanceOf(treasury) - f0;
        if (usdt.balanceOf(landlord) > l0 || usdt.balanceOf(treasury) > f0) {
            if (due > maxDueSeen) maxDueSeen = due;
        }
        if (!wasSettled && escrow.status() == RentalEscrow.Status.Settled) {
            settled = true;
            dueAtSettle = due;
            settledBy = bytes4(data);
            settledCaller = who;
        }
    }

    function payRent(uint32 months) external {
        if (!_has(tenant)) return;
        _run(tenant, abi.encodeCall(RentalEscrow.payRent, (uint32(bound(months, 1, 12)))));
    }

    function releaseRent(uint256 seed) external {
        address who = _actor(seed);
        uint32 funded = escrow.monthsFunded();
        if (_run(who, abi.encodeCall(RentalEscrow.releaseRent, ())) && who == tenant) {
            if (funded > tenantEarlyRelease) tenantEarlyRelease = funded;
        }
    }

    /// @dev propose/dispute end the rental phase, so only one call in four goes through; otherwise a run
    /// settles in its first few steps and never reaches multi-month rent or the landlord-silence timeout.
    function propose(uint256 seed, uint256 refund) external {
        if (seed % 4 != 0) return;
        address who = _actor(seed / 4);
        refund = bound(refund, 0, escrow.terms().depositAmount + 1);
        if (_run(who, abi.encodeCall(RentalEscrow.propose, (refund, keccak256("report")))) && who == tenant) {
            tenantActed = true;
        }
    }

    function accept(uint256 seed, bool staleNonce) external {
        address who = _actor(seed);
        RentalEscrow.Proposal memory p = escrow.proposal();
        uint32 nonce = staleNonce ? p.nonce + 1 : p.nonce;
        if (_run(who, abi.encodeCall(RentalEscrow.accept, (nonce)))) {
            landlordClaim = p.landlordClaim;
            tenantRefund = p.tenantRefund;
            if (who == tenant) tenantActed = true;
        }
    }

    function dispute(uint256 seed) external {
        if (seed % 4 != 0) return;
        _run(_actor(seed / 4), abi.encodeCall(RentalEscrow.dispute, ()));
    }

    function resolve(uint256 seed, uint256 refund) external {
        address who = _actor(seed);
        uint256 deposit = escrow.terms().depositAmount;
        refund = bound(refund, 0, deposit + 1);
        if (_run(who, abi.encodeCall(RentalEscrow.resolve, (refund, keccak256("ruling"))))) {
            landlordClaim = deposit - refund;
            tenantRefund = refund;
            if (who == arbiter) arbiterActed = true;
        }
    }

    function claimTimeout(uint256 seed) external {
        if (_run(_actor(seed), abi.encodeCall(RentalEscrow.claimTimeout, ()))) {
            tenantRefund = escrow.terms().depositAmount;
        }
    }

    function claimArbiterTimeout(uint256 seed) external {
        if (_run(_actor(seed), abi.encodeCall(RentalEscrow.claimArbiterTimeout, ()))) {
            tenantRefund = escrow.terms().depositAmount;
        }
    }

    function addEvidence(uint256 seed, uint8 kind, bytes32 h) external {
        _run(_actor(seed), abi.encodeCall(RentalEscrow.addEvidence, (RentalEscrow.EvidenceKind(kind % 3), h)));
    }

    function cancel(uint256 seed) external {
        _run(_actor(seed), abi.encodeCall(RentalEscrow.cancel, ()));
    }

    function warp(uint256 secs) external {
        skip(bound(secs, 0, 45 days));
    }
}

/// @notice Invariants for one escrow driven by every role (landlord, tenant, arbiter, a keeper).
contract RentalEscrowInvariantTest is Test {
    uint256 internal constant RENT = 500e6;
    uint256 internal constant DEPOSIT = 1_000e6;
    uint32 internal constant TERM = 12;
    uint16 internal constant FEE_BPS = 1_000;

    MockUSDT internal usdt;
    RentalEscrow internal escrow;
    EscrowHandler internal handler;
    address internal landlord = makeAddr("landlord");
    address internal tenant = makeAddr("tenant");
    address internal arbiter = makeAddr("arbiter");
    address internal keeper = makeAddr("keeper");
    address internal treasury = makeAddr("treasury");

    function _actors() internal view virtual returns (address[] memory a) {
        a = new address[](4);
        (a[0], a[1], a[2], a[3]) = (landlord, tenant, arbiter, keeper);
    }

    function setUp() public {
        vm.warp(1_790_000_000);
        usdt = new MockUSDT();
        EscrowFactory factory =
            new EscrowFactory(IERC20(address(usdt)), address(this), FEE_BPS, treasury, address(0));
        vm.prank(landlord);
        escrow = RentalEscrow(
            factory.createLease(
                EscrowFactory.LeaseParams({
                    tenant: tenant,
                    arbiter: arbiter,
                    rentAmount: RENT,
                    depositAmount: DEPOSIT,
                    termMonths: TERM,
                    responseWindow: 0,
                    arbiterWindow: 0,
                    leaseHash: keccak256("lease")
                })
            )
        );
        usdt.faucet(tenant, 10_000e6);
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        vm.stopPrank();

        handler = new EscrowHandler(escrow, usdt, treasury, _actors());
        targetContract(address(handler));
    }

    /// Funds conservation: every token the tenant paid in is either still in the escrow or was paid out.
    function invariant_fundsConserved() public view {
        assertEq(
            handler.tenantIn(),
            usdt.balanceOf(address(escrow)) + handler.tenantOut() + handler.landlordOut() + handler.feeOut()
        );
    }

    /// Escrow balance == deposit (while live) + funded rent not yet released; nothing at all once settled.
    function invariant_balanceMatchesBook() public view {
        RentalEscrow.Status s = escrow.status();
        uint256 bal = usdt.balanceOf(address(escrow));
        if (s == RentalEscrow.Status.Settled) {
            assertEq(bal, 0);
        } else {
            assertEq(bal, DEPOSIT + uint256(escrow.monthsFunded() - escrow.monthsReleased()) * RENT);
        }
        assertLe(escrow.monthsReleased(), escrow.monthsFunded());
        assertLe(escrow.monthsFunded(), TERM);
    }

    /// Rent leaves only for released months, and only per schedule or by the tenant's own early release.
    function invariant_rentFollowsSchedule() public view {
        uint256 rentOut = handler.landlordOut() - handler.landlordClaim() + handler.feeOut();
        assertEq(rentOut, uint256(escrow.monthsReleased()) * RENT);
        uint32 due = handler.maxDueSeen();
        uint32 cap = due > handler.tenantEarlyRelease() ? due : handler.tenantEarlyRelease();
        assertLe(escrow.monthsReleased(), cap);
        // One-time protocol fee: 10% of ONE month's rent, charged at most once.
        assertEq(handler.feeOut(), escrow.feeCharged() ? (RENT * FEE_BPS) / 10_000 : 0);
    }

    /// The deposit is split exactly once and only with the counterparty's or the arbiter's consent:
    /// the landlord gets any of it only if the tenant agreed (propose/accept) or the arbiter ruled.
    function invariant_depositNeedsConsent() public view {
        if (!handler.settled()) {
            assertEq(handler.landlordClaim() + handler.tenantRefund(), 0);
            return;
        }
        assertEq(handler.landlordClaim() + handler.tenantRefund(), DEPOSIT);
        bytes4 by = handler.settledBy();
        if (handler.landlordClaim() > 0) {
            assertTrue(by == RentalEscrow.accept.selector || by == RentalEscrow.resolve.selector);
            assertTrue(handler.tenantActed() || handler.arbiterActed());
        }
        if (by == RentalEscrow.resolve.selector) assertEq(handler.settledCaller(), arbiter);
        if (by == RentalEscrow.accept.selector) {
            address c = handler.settledCaller();
            assertTrue(c == landlord || c == tenant);
            assertTrue(c != escrow.proposal().proposer);
        }
        // Keeper-triggered settlements (the two timeouts) always return the full deposit to the tenant.
        if (by == RentalEscrow.claimTimeout.selector || by == RentalEscrow.claimArbiterTimeout.selector) {
            assertEq(handler.tenantRefund(), DEPOSIT);
        }
    }
}

/// @notice Landlord acting alone (plus any keeper): can never take any of the deposit.
contract LandlordAloneInvariantTest is RentalEscrowInvariantTest {
    function _actors() internal view override returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (landlord, keeper);
    }

    function invariant_landlordAloneGetsNoDeposit() public view {
        assertEq(handler.landlordClaim(), 0);
    }
}

/// @notice Tenant acting alone (plus any keeper): every funded month that fell due is paid to the landlord
/// at settlement, the deposit can come back only through the landlord-silence timeout.
contract TenantAloneInvariantTest is RentalEscrowInvariantTest {
    function _actors() internal view override returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (tenant, keeper);
    }

    function invariant_tenantAloneCannotSkipDueRent() public view {
        if (!handler.settled()) return;
        uint32 funded = escrow.monthsFunded();
        uint32 due = handler.dueAtSettle();
        assertGe(escrow.monthsReleased(), due < funded ? due : funded);
    }
}

/// @notice Arbiter acting alone (plus any keeper): without a dispute raised by a party it cannot move the deposit.
contract ArbiterAloneInvariantTest is RentalEscrowInvariantTest {
    function _actors() internal view override returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (arbiter, keeper);
    }

    function invariant_arbiterAloneCannotSettle() public view {
        assertFalse(handler.settled());
        uint256 unreleased = uint256(escrow.monthsFunded() - escrow.monthsReleased()) * RENT;
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT + unreleased);
    }
}
