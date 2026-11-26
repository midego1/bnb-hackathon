// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {FleetVault} from "../src/FleetVault.sol";

/// Regression tests for the findings fixed in docs/SECURITY.md (one section per finding ID).
contract SecurityRegressionTest is BaseTest {
    FleetVault internal vault;
    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");
    address internal attacker = makeAddr("attacker");

    function setUp() public override {
        super.setUp();
        vault = new FleetVault(
            IERC20(address(usdt)), "KeyScrow Bangkok Fleet 1", "BKK-FLEET-1", operator, 1_000
        );
        usdt.faucet(alice, 10_000e6);
        vm.prank(alice);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.deposit(1_000e6);
    }

    // =============================================================================================
    // KE-01: FleetVault income sniping (deposit -> trigger escrow payout -> claim -> redeem)
    // =============================================================================================

    function _vaultLeaseWithDueRent() internal returns (RentalEscrow escrow) {
        vm.prank(landlord);
        escrow = RentalEscrow(factory.createLeaseWithPayee(_params(), address(vault)));
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        escrow.payRent(2);
        vm.stopPrank();
        skip(2 * PERIOD); // three funded months are due; anyone may release them
        skip(1);
    }

    /// The whole attack in one transaction (as with a flash loan) now fails at the redeem step.
    function test_KE01_atomicSnipeCannotRedeem() public {
        RentalEscrow escrow = _vaultLeaseWithDueRent();
        uint256 loan = 99_000e6; // 99x the honest shareholder's stake
        for (uint256 i; i < 10; ++i) usdt.faucet(attacker, 9_900e6);

        vm.startPrank(attacker);
        usdt.approve(address(vault), type(uint256).max);
        vault.deposit(loan);
        escrow.releaseRent(); // anyone can trigger the payout of due rent into the vault
        uint256 skimmed = vault.claim();
        vm.expectRevert(abi.encodeWithSelector(FleetVault.SharesLocked.selector, block.timestamp + 7 days));
        vault.redeem(loan); // cannot repay the loan in the same transaction
        vm.stopPrank();

        // The attacker did get income for shares it held when the payout arrived, but its principal is stuck
        // for SHARE_LOCK, so a flash-loan version of the attack cannot be repaid and reverts as a whole.
        assertGt(skimmed, 0);
        assertEq(vault.balanceOf(attacker), loan);
    }

    function test_KE01_lockBlocksTransferToo_andLiftsAfterSharelock() public {
        usdt.faucet(attacker, 1_000e6);
        vm.startPrank(attacker);
        usdt.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6);
        uint256 until = vault.lockedUntil(attacker);
        assertEq(until, block.timestamp + vault.SHARE_LOCK());

        vm.expectRevert(abi.encodeWithSelector(FleetVault.SharesLocked.selector, until));
        vault.transfer(alice, 1); // moving shares to a fresh address does not bypass the lock

        vm.warp(until - 1);
        vm.expectRevert(abi.encodeWithSelector(FleetVault.SharesLocked.selector, until));
        vault.redeem(1_000e6);

        vm.warp(until);
        vault.redeem(1_000e6);
        vm.stopPrank();
        assertEq(usdt.balanceOf(attacker), 1_000e6);
    }

    function test_KE01_claimNeverLocked_receiverNotLocked() public {
        usdt.faucet(address(vault), 100e6); // income for alice's shares
        vm.prank(alice);
        assertEq(vault.claim(), 90e6); // still within alice's lock: claiming is always allowed

        skip(vault.SHARE_LOCK());
        vm.prank(alice);
        assertTrue(vault.transfer(attacker, 400e6));
        assertEq(vault.lockedUntil(attacker), 0); // receiving shares does not lock (no griefing by dust transfers)
        vm.prank(attacker);
        vault.redeem(400e6);
    }

    function test_KE01_topUpRestartsLock() public {
        skip(vault.SHARE_LOCK());
        vm.prank(alice);
        vault.deposit(1e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FleetVault.SharesLocked.selector, block.timestamp + 7 days));
        vault.redeem(1);
    }

    // =============================================================================================
    // KE-02: landlord could race claimTimeout after the response window (late dispute / counter / accept)
    // =============================================================================================

    function _tenantProposal() internal returns (RentalEscrow escrow, uint64 deadline) {
        escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT - 100e6, REPORT_HASH);
        deadline = escrow.timeoutAt();
    }

    function test_KE02_landlordCannotActAfterResponseWindow() public {
        (RentalEscrow escrow, uint64 deadline) = _tenantProposal();
        vm.warp(deadline);
        bytes memory closed = abi.encodeWithSelector(RentalEscrow.ResponseWindowClosed.selector, deadline);

        vm.startPrank(landlord);
        vm.expectRevert(closed);
        escrow.dispute();
        vm.expectRevert(closed);
        escrow.propose(0, REPORT_HASH);
        vm.expectRevert(closed);
        escrow.accept(1);
        vm.stopPrank();

        vm.prank(tenant); // the tenant cannot reopen the round either; the outcome is fixed
        vm.expectRevert(closed);
        escrow.propose(0, REPORT_HASH);

        uint256 tenantBefore = usdt.balanceOf(tenant);
        vm.prank(stranger);
        escrow.claimTimeout();
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT);
    }

    function test_KE02_landlordCanStillActOneSecondBefore() public {
        (RentalEscrow escrow, uint64 deadline) = _tenantProposal();
        vm.warp(deadline - 1);
        vm.prank(landlord);
        escrow.dispute();
        assertEq(uint8(escrow.status()), uint8(RentalEscrow.Status.Disputed));
    }

    function test_KE02_landlordProposalHasNoWindow() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(landlord);
        escrow.propose(0, REPORT_HASH);
        skip(365 days); // no timeout on a landlord proposal: the tenant can still answer at any time
        vm.prank(tenant);
        escrow.dispute();
    }

    // =============================================================================================
    // KE-03: payee may not be the renter or the arbiter
    // =============================================================================================

    function test_KE03_payeeCannotBeArbiterOrTenant() public {
        vm.startPrank(landlord);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLeaseWithPayee(_params(), arbiter);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLeaseWithPayee(_params(), tenant);

        EscrowFactory.LeaseParams memory p = _params();
        p.arbiter = address(0); // default arbiter: the dispute desk
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLeaseWithPayee(p, disputeDesk);

        // Any other payee (a vault, the owner's own cold wallet) still works.
        factory.createLeaseWithPayee(p, address(vault));
        vm.stopPrank();
    }

    // =============================================================================================
    // KE-14 (audit #9): delaying settlement must not turn the renter's prepaid rent into rent due
    // =============================================================================================

    /// Three months prepaid, the renter returns on day 10. Settled that day, months 1 and 2 are refunded.
    function _prepaidLease(uint32 responseWindow, uint32 arbiterWindow)
        internal
        returns (RentalEscrow escrow)
    {
        EscrowFactory.LeaseParams memory p = _params();
        (p.responseWindow, p.arbiterWindow) = (responseWindow, arbiterWindow);
        vm.prank(landlord);
        escrow = RentalEscrow(factory.createLease(p));
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        escrow.payRent(2);
        vm.stopPrank();
    }

    function test_KE14_disputeAndSilentArbiterDoNotMakePrepaidRentDue() public {
        RentalEscrow escrow = _prepaidLease(WINDOW, 90 days);
        uint256 tenantBefore = usdt.balanceOf(tenant);
        skip(10 days);
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH); // the return
        skip(4 days);
        vm.prank(landlord);
        escrow.dispute(); // then nobody rules for 90 days
        vm.warp(escrow.arbiterDeadline());
        escrow.claimArbiterTimeout();

        assertEq(usdt.balanceOf(landlord), RENT - FEE); // only month 0 was due at the return
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT + 2 * RENT);
    }

    function test_KE14_silentLandlordDoesNotMakePrepaidRentDue() public {
        RentalEscrow escrow = _prepaidLease(60 days, ARB_WINDOW);
        uint256 tenantBefore = usdt.balanceOf(tenant);
        skip(25 days);
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.warp(escrow.timeoutAt()); // day 85: two more due dates passed while the landlord stayed silent
        escrow.claimTimeout();

        assertEq(usdt.balanceOf(landlord), RENT - FEE);
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT + 2 * RENT);
    }

    // =============================================================================================
    // KE-15 (audit #10): a share transfer must not hand the seller's unsynced income to the buyer
    // =============================================================================================

    function test_KE15_transferKeepsUnsyncedIncomeWithSeller() public {
        address bob = makeAddr("bob");
        skip(vault.SHARE_LOCK());
        usdt.faucet(address(vault), 100e6); // rent arrives; nobody syncs
        vm.prank(alice);
        vault.transfer(bob, 1_000e6);

        assertEq(vault.claimable(bob), 0);
        vm.prank(alice);
        assertEq(vault.claim(), 90e6); // 100 minus the 10 % operator fee
    }

    // =============================================================================================
    // Clone initialization (no finding; kept next to the other access-control checks)
    // =============================================================================================

    function test_clone_initializedInCreationTx_cannotBeReinitialized() public {
        RentalEscrow escrow = _createLease();
        RentalEscrow.Terms memory t = escrow.terms();
        t.tenant = stranger;
        vm.prank(stranger);
        vm.expectRevert();
        escrow.initialize(t, stranger);
        assertEq(escrow.terms().tenant, tenant);
        assertEq(escrow.payee(), landlord);
    }
}
