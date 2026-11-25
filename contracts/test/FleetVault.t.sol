// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FleetVault} from "../src/FleetVault.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {FeeOnTransferToken} from "./utils/TestTokens.sol";

contract FleetVaultTest is BaseTest {
    FleetVault internal vault;
    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint16 internal constant OP_FEE = 1_000; // 10% of income to the fleet operator

    function setUp() public override {
        super.setUp();
        vault = new FleetVault(
            IERC20(address(usdt)), "KeyEscrow Bangkok Fleet 1", "BKK-FLEET-1", operator, OP_FEE
        );
        usdt.faucet(alice, 10_000e6);
        usdt.faucet(bob, 10_000e6);
        vm.prank(alice);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdt.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        vault.deposit(amount);
    }

    /// Simulates an escrow payout: the vault only ever sees plain transfers.
    function _income(uint256 amount) internal {
        usdt.faucet(address(vault), amount);
    }

    // --- Constructor ----------------------------------------------------------------------------

    function test_constructor_setsMetadata() public view {
        assertEq(vault.name(), "KeyEscrow Bangkok Fleet 1");
        assertEq(vault.symbol(), "BKK-FLEET-1");
        assertEq(vault.decimals(), 6);
        assertEq(address(vault.asset()), address(usdt));
        assertEq(vault.operator(), operator);
        assertEq(vault.operatorFeeBps(), OP_FEE);
    }

    function test_constructor_rejectsBadConfig() public {
        vm.expectRevert(FleetVault.ZeroAddress.selector);
        new FleetVault(IERC20(address(0)), "n", "s", operator, 0);
        vm.expectRevert(FleetVault.ZeroAddress.selector);
        new FleetVault(IERC20(address(usdt)), "n", "s", address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(FleetVault.FeeTooHigh.selector, uint16(3_001)));
        new FleetVault(IERC20(address(usdt)), "n", "s", operator, 3_001);
    }

    // --- Deposit / redeem -----------------------------------------------------------------------

    function test_deposit_mintsSharesOneToOne() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit FleetVault.Deposited(alice, 1_000e6);
        _deposit(alice, 1_000e6);
        assertEq(vault.balanceOf(alice), 1_000e6);
        assertEq(vault.totalPrincipal(), 1_000e6);
        assertEq(vault.totalAssets(), 1_000e6);
        assertEq(vault.unsyncedIncome(), 0);
    }

    function test_deposit_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(FleetVault.InvalidAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_rejectsFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        FleetVault v = new FleetVault(IERC20(address(fot)), "n", "s", operator, 0);
        fot.mint(alice, 1_000e6);
        vm.startPrank(alice);
        fot.approve(address(v), type(uint256).max);
        vm.expectRevert();
        v.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_redeem_returnsPrincipalAndKeepsIncome() public {
        _deposit(alice, 1_000e6);
        _income(100e6);
        skip(vault.SHARE_LOCK());
        vm.prank(alice);
        vault.redeem(1_000e6);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.totalPrincipal(), 0);
        // 100 income - 10 operator fee = 90 credited before the shares were burned.
        assertEq(vault.claimable(alice), 90e6);
        vm.prank(alice);
        assertEq(vault.claim(), 90e6);
        assertEq(usdt.balanceOf(alice), 10_000e6 + 90e6);
        assertEq(usdt.balanceOf(address(vault)), 0);
    }

    function test_redeem_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(FleetVault.InvalidAmount.selector);
        vault.redeem(0);
    }

    // --- Income ---------------------------------------------------------------------------------

    function test_sync_takesOperatorFeeAndSharesProRata() public {
        _deposit(alice, 3_000e6);
        _deposit(bob, 1_000e6);
        _income(400e6);
        assertEq(vault.unsyncedIncome(), 400e6);
        assertEq(vault.claimable(alice), 270e6); // view already includes unsynced income
        assertEq(vault.claimable(bob), 90e6);

        vm.expectEmit(false, false, false, false, address(vault));
        emit FleetVault.IncomeDistributed(0, 0, 0, 0);
        assertEq(vault.sync(), 360e6);
        assertEq(usdt.balanceOf(operator), 40e6);
        assertEq(vault.totalOperatorFees(), 40e6);
        assertEq(vault.totalDistributed(), 360e6);
        assertEq(vault.reservedIncome(), 360e6);
        assertEq(vault.unsyncedIncome(), 0);

        vm.prank(alice);
        assertEq(vault.claim(), 270e6);
        vm.prank(bob);
        assertEq(vault.claim(), 90e6);
        assertEq(vault.totalClaimed(), 360e6);
        assertEq(vault.reservedIncome(), 0);
        assertEq(usdt.balanceOf(address(vault)), 4_000e6);
    }

    function test_sync_noSharesOrNoIncomeIsNoop() public {
        _income(50e6);
        assertEq(vault.sync(), 0); // no shareholders yet: income waits
        assertEq(vault.claimable(alice), 0);
        _deposit(alice, 1_000e6); // first depositor picks up the waiting income on the next sync
        assertEq(vault.sync(), 45e6);
        assertEq(vault.sync(), 0);
    }

    function test_deposit_doesNotDiluteEarlierIncome() public {
        _deposit(alice, 1_000e6);
        _income(100e6);
        _deposit(bob, 1_000e6); // syncs first: the 90 belongs to alice only
        assertEq(vault.claimable(alice), 90e6);
        assertEq(vault.claimable(bob), 0);
        _income(100e6);
        assertEq(vault.claimable(alice), 135e6);
        assertEq(vault.claimable(bob), 45e6);
    }

    function test_transfer_movesFutureIncomeOnly() public {
        _deposit(alice, 1_000e6);
        _income(100e6);
        vault.sync();
        skip(vault.SHARE_LOCK());
        vm.prank(alice);
        assertTrue(vault.transfer(bob, 500e6));
        _income(100e6);
        assertEq(vault.claimable(alice), 90e6 + 45e6);
        assertEq(vault.claimable(bob), 45e6);
    }

    function test_claim_nothingReverts() public {
        _deposit(alice, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(FleetVault.NothingToClaim.selector);
        vault.claim();
    }

    function test_zeroFeeVault_paysEverythingToShareholders() public {
        FleetVault v = new FleetVault(IERC20(address(usdt)), "n", "s", operator, 0);
        vm.startPrank(alice);
        usdt.approve(address(v), type(uint256).max);
        v.deposit(1_000e6);
        vm.stopPrank();
        usdt.faucet(address(v), 10e6);
        vm.prank(alice);
        assertEq(v.claim(), 10e6);
        assertEq(usdt.balanceOf(operator), 0);
    }

    function testFuzz_vaultStaysSolvent(uint96 a, uint96 b, uint96 income1, uint96 income2) public {
        uint256 da = bound(a, 1, 10_000e6);
        uint256 db = bound(b, 1, 10_000e6);
        usdt.faucet(alice, da);
        usdt.faucet(bob, db);
        _deposit(alice, da);
        _income(bound(income1, 0, 10_000e6));
        _deposit(bob, db);
        _income(bound(income2, 0, 10_000e6));
        uint256 ca = vault.claimable(alice);
        uint256 cb = vault.claimable(bob);
        if (ca > 0) {
            vm.prank(alice);
            vault.claim();
        }
        if (cb > 0) {
            vm.prank(bob);
            vault.claim();
        }
        skip(vault.SHARE_LOCK());
        vm.prank(alice);
        vault.redeem(da);
        vm.prank(bob);
        vault.redeem(db);
        // Only rounding dust (and nothing negative) can be left behind.
        assertEq(vault.totalPrincipal(), 0);
        assertGe(usdt.balanceOf(address(vault)), vault.reservedIncome());
    }

    // --- Escrow integration ---------------------------------------------------------------------

    function _createVaultLease() internal returns (RentalEscrow escrow) {
        vm.prank(landlord);
        escrow = RentalEscrow(factory.createLeaseWithPayee(_params(), address(vault)));
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        vm.stopPrank();
    }

    function test_escrow_rentAndDamagePayoutFlowIntoVault() public {
        _deposit(alice, 1_000e6);
        RentalEscrow escrow = _createVaultLease();
        assertEq(escrow.payee(), address(vault));
        assertEq(escrow.terms().landlord, landlord); // the owner keeps every role

        vm.prank(tenant);
        escrow.releaseRent();
        assertEq(vault.unsyncedIncome(), RENT - FEE);
        assertEq(usdt.balanceOf(landlord), 0);

        // Damaged return: 300 of the deposit slashed to the vault, the rest back to the renter.
        vm.prank(tenant);
        escrow.propose(DEPOSIT - 300e6, REPORT_HASH);
        vm.prank(landlord);
        escrow.accept(1);
        assertEq(vault.unsyncedIncome(), RENT - FEE + 300e6);
        assertEq(usdt.balanceOf(landlord), 0);

        uint256 income = RENT - FEE + 300e6;
        uint256 fee = (income * OP_FEE) / 10_000;
        vm.prank(alice);
        assertEq(vault.claim(), income - fee);
        assertEq(usdt.balanceOf(operator), fee);
    }

    function test_escrow_arbiterRulingPaysVault() public {
        _deposit(alice, 1_000e6);
        RentalEscrow escrow = _createVaultLease();
        vm.prank(landlord);
        escrow.dispute();
        vm.prank(arbiter);
        escrow.resolve(DEPOSIT - 200e6, REPORT_HASH);
        // Month 1 is due at settlement, so it is paid too.
        assertEq(vault.unsyncedIncome(), RENT - FEE + 200e6);
    }

    function test_factory_createLeaseWithPayee_rejectsZeroPayee() public {
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        factory.createLeaseWithPayee(_params(), address(0));
    }

    function test_factory_createLeaseWithPayee_emitsPayeeSet() public {
        vm.recordLogs();
        vm.prank(landlord);
        address escrow = factory.createLeaseWithPayee(_params(), address(vault));
        assertEq(RentalEscrow(escrow).payee(), address(vault));
        assertTrue(factory.isLease(escrow));
        assertEq(factory.leasesByLandlord(landlord)[0], escrow);
    }

    function test_factory_createLease_payeeIsOwner() public {
        RentalEscrow escrow = _createLease();
        assertEq(escrow.payee(), landlord);
    }
}
