// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FleetVault} from "../../src/FleetVault.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockBscUsd} from "../mocks/MockBscUsd.sol";

/// @dev Random deposits, redeems, claims, share transfers, income (plain transfers, exactly like an escrow
/// payout) and time jumps by three investors.
contract VaultHandler is Test {
    FleetVault public immutable vault;
    MockUSDT public immutable usdt;
    address[3] public investors;

    uint256 public deposited;
    uint256 public redeemed;
    uint256 public incomeIn;
    uint256 public claimed;
    uint256 public lockViolations; // shares that left an account inside its deposit lock
    uint256 public incomeShifts; // transfers that changed what either side could claim (KE-15)
    uint256 public immutable unit; // 1 token in base units (6 or 18 decimals)
    mapping(address => uint256) public lastDeposit;

    constructor(FleetVault vault_, MockUSDT usdt_) {
        vault = vault_;
        usdt = usdt_;
        unit = 10 ** usdt_.decimals();
        investors = [makeAddr("inv0"), makeAddr("inv1"), makeAddr("inv2")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(investors[i]);
            usdt.approve(address(vault_), type(uint256).max);
        }
    }

    function investor(uint256 i) external view returns (address) {
        return investors[i];
    }

    function _who(uint256 seed) internal view returns (address) {
        return investors[seed % 3];
    }

    function _locked(address who) internal view returns (bool) {
        return lastDeposit[who] != 0 && block.timestamp < lastDeposit[who] + vault.SHARE_LOCK();
    }

    function deposit(uint256 seed, uint256 amount) external {
        address who = _who(seed);
        amount = bound(amount, 1, 10_000 * unit);
        usdt.faucet(who, amount);
        vm.prank(who);
        vault.deposit(amount);
        deposited += amount;
        lastDeposit[who] = block.timestamp;
    }

    function redeem(uint256 seed, uint256 shares) external {
        address who = _who(seed);
        uint256 bal = vault.balanceOf(who);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        bool locked = _locked(who);
        vm.prank(who);
        try vault.redeem(shares) {
            redeemed += shares;
            if (locked) ++lockViolations;
        } catch {}
    }

    function transferShares(uint256 seed, uint256 to, uint256 shares) external {
        address from = _who(seed);
        uint256 bal = vault.balanceOf(from);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        bool locked = _locked(from);
        address dest = _who(to);
        (uint256 c0, uint256 d0) = (vault.claimable(from), vault.claimable(dest));
        vm.prank(from);
        try vault.transfer(dest, shares) {
            if (locked) ++lockViolations;
            // Income earned so far (synced or not) stays with whoever held the shares when it arrived.
            if (vault.claimable(from) != c0 || vault.claimable(dest) != d0) ++incomeShifts;
        } catch {}
    }

    function claim(uint256 seed) external {
        address who = _who(seed);
        if (vault.claimable(who) == 0) return;
        vm.prank(who);
        claimed += vault.claim();
    }

    function income(uint256 amount) external {
        amount = bound(amount, 0, 5_000 * unit);
        usdt.faucet(address(vault), amount);
        incomeIn += amount;
    }

    function sync() external {
        vault.sync();
    }

    function warp(uint256 secs) external {
        skip(bound(secs, 0, 10 days));
    }
}

contract FleetVaultInvariantTest is Test {
    MockUSDT internal usdt;
    FleetVault internal vault;
    VaultHandler internal handler;
    address internal operator = makeAddr("operator");
    uint16 internal constant OP_FEE = 1_000;

    /// @dev 6 (MockUSDT) by default; 18 (BSC-USD) in FleetVault18DecimalsInvariantTest.
    function _decimals() internal pure virtual returns (uint8) {
        return 6;
    }

    function setUp() public {
        vm.warp(1_790_000_000);
        usdt = _decimals() == 6 ? new MockUSDT() : MockUSDT(address(new MockBscUsd()));
        vault = new FleetVault(
            IERC20(address(usdt)), "KeyEscrow Bangkok Fleet 1", "BKK-FLEET-1", operator, OP_FEE
        );
        handler = new VaultHandler(vault, usdt);
        targetContract(address(handler));
    }

    /// Solvency: the vault always holds every investor's principal plus all credited, unclaimed income.
    function invariant_solvent() public view {
        assertGe(usdt.balanceOf(address(vault)), vault.totalPrincipal() + vault.reservedIncome());
        // ...and enough for everything the investors could claim right now (incl. not-yet-synced income).
        uint256 claims;
        for (uint256 i; i < 3; ++i) claims += vault.claimable(handler.investor(i));
        uint256 unsynced = vault.unsyncedIncome();
        uint256 owedOut = vault.totalSupply() == 0 ? 0 : unsynced - (unsynced * OP_FEE) / 10_000;
        assertLe(claims, vault.reservedIncome() + owedOut);
    }

    /// Shares are principal 1:1 and principal only moves through deposit/redeem.
    function invariant_principalBook() public view {
        assertEq(vault.totalSupply(), vault.totalPrincipal());
        assertEq(vault.totalPrincipal(), handler.deposited() - handler.redeemed());
    }

    /// Income book: every token of income is split exactly once (operator fee + shareholders) or still waiting.
    function invariant_incomeBook() public view {
        assertEq(
            handler.incomeIn(), vault.totalDistributed() + vault.totalOperatorFees() + vault.unsyncedIncome()
        );
        assertEq(usdt.balanceOf(operator), vault.totalOperatorFees());
        assertEq(vault.totalClaimed(), handler.claimed());
        assertEq(vault.reservedIncome(), vault.totalDistributed() - vault.totalClaimed());
    }

    /// KE-01: no shares ever left an account within SHARE_LOCK of its latest deposit.
    function invariant_shareLockHolds() public view {
        assertEq(handler.lockViolations(), 0);
    }

    /// KE-15: a share transfer never changes what the seller or the buyer can claim (unsynced income included).
    function invariant_transferMovesNoIncome() public view {
        assertEq(handler.incomeShifts(), 0);
    }

    /// After any history, everyone can exit: claim all income and redeem all principal, leaving only dust.
    function afterInvariant() public {
        vault.sync();
        skip(vault.SHARE_LOCK());
        for (uint256 i; i < 3; ++i) {
            address who = handler.investor(i);
            if (vault.claimable(who) > 0) {
                vm.prank(who);
                vault.claim();
            }
            uint256 bal = vault.balanceOf(who);
            if (bal > 0) {
                vm.prank(who);
                vault.redeem(bal);
            }
        }
        assertEq(vault.totalPrincipal(), 0);
        assertEq(usdt.balanceOf(address(vault)), vault.reservedIncome() + vault.unsyncedIncome());
        // Per-share rounding leaves dust behind: up to supply / 1e18 base units per sync (the accumulator's precision),
        // i.e. a few base units with 6 decimals and a few thousand wei (~1e-14 USDT) with 18. Bound: 1e-9 token.
        assertLe(vault.reservedIncome(), 1_000 + 10 ** _decimals() / 1e9);
    }
}

/// The same vault invariants with an 18-decimal asset (BSC-USD).
contract FleetVault18DecimalsInvariantTest is FleetVaultInvariantTest {
    function _decimals() internal pure override returns (uint8) {
        return 18;
    }
}
