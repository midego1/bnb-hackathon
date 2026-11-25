// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {ReentrantToken, FeeOnTransferToken} from "./utils/TestTokens.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";

contract RentalEscrowTest is BaseTest {
    RentalEscrow.Status constant CREATED = RentalEscrow.Status.Created;
    RentalEscrow.Status constant ACTIVE = RentalEscrow.Status.Active;
    RentalEscrow.Status constant MOVE_OUT = RentalEscrow.Status.MoveOut;
    RentalEscrow.Status constant DISPUTED = RentalEscrow.Status.Disputed;
    RentalEscrow.Status constant SETTLED = RentalEscrow.Status.Settled;
    RentalEscrow.Status constant CANCELLED = RentalEscrow.Status.Cancelled;

    // =============================================================================================
    // Funding
    // =============================================================================================

    function test_fund_pullsDepositAndFirstRent() public {
        uint256 tenantBefore = usdt.balanceOf(tenant);
        RentalEscrow escrow = _createAndFund();

        assertEq(uint8(escrow.status()), uint8(ACTIVE));
        assertEq(escrow.startTime(), block.timestamp);
        assertEq(escrow.monthsFunded(), 1);
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT + RENT);
        assertEq(usdt.balanceOf(tenant), tenantBefore - DEPOSIT - RENT);
    }

    function test_fund_revertsForWrongCaller() public {
        RentalEscrow escrow = _createLease();
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, landlord));
        escrow.fund();
    }

    function test_fund_revertsWhenFundedTwice() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, ACTIVE));
        escrow.fund();
    }

    function test_fund_revertsWithoutAllowance() public {
        RentalEscrow escrow = _createLease();
        vm.prank(tenant);
        vm.expectRevert();
        escrow.fund();
    }

    function test_fund_revertsOnFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        EscrowFactory f =
            new EscrowFactory(IERC20(address(fot)), owner, 0, address(0), address(0), NO_CAP, NO_CAP, NO_CAP);
        vm.prank(landlord);
        RentalEscrow escrow = RentalEscrow(f.createLease(_params()));

        fot.mint(tenant, 10_000 * UNIT);
        vm.startPrank(tenant);
        fot.approve(address(escrow), type(uint256).max);
        uint256 amount = DEPOSIT + RENT;
        vm.expectRevert(
            abi.encodeWithSelector(RentalEscrow.TransferShortfall.selector, amount, amount - amount / 100)
        );
        escrow.fund();
        vm.stopPrank();
    }

    // =============================================================================================
    // Cancel
    // =============================================================================================

    function test_cancel_byLandlordBeforeFunding() public {
        RentalEscrow escrow = _createLease();
        vm.prank(landlord);
        escrow.cancel();
        assertEq(uint8(escrow.status()), uint8(CANCELLED));

        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CANCELLED));
        escrow.fund();
    }

    function test_cancel_revertsForWrongCallerOrAfterFunding() public {
        RentalEscrow escrow = _createLease();
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, tenant));
        escrow.cancel();

        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        vm.stopPrank();

        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, ACTIVE));
        escrow.cancel();
    }

    // =============================================================================================
    // Rent
    // =============================================================================================

    function test_payRent_prepaysMonths() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(3);
        assertEq(escrow.monthsFunded(), 4);
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT + 4 * RENT);
    }

    function test_payRent_reverts() public {
        RentalEscrow escrow = _createAndFund();

        vm.prank(tenant);
        vm.expectRevert(RentalEscrow.InvalidAmount.selector);
        escrow.payRent(0);

        vm.prank(tenant);
        vm.expectRevert(RentalEscrow.TermFullyFunded.selector);
        escrow.payRent(TERM); // 1 already funded

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, stranger));
        escrow.payRent(1);

        RentalEscrow unfunded = _createLease();
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CREATED));
        unfunded.payRent(1);
    }

    function test_releaseRent_firstMonthDueImmediately_byAnyone() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(stranger);
        escrow.releaseRent();

        assertEq(escrow.monthsReleased(), 1);
        assertEq(usdt.balanceOf(landlord), RENT - FEE);
        assertEq(usdt.balanceOf(treasury), FEE);
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT);
    }

    function test_releaseRent_notDue_revertsForStranger_butTenantCanReleaseEarly() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(1);
        escrow.releaseRent(); // month 0

        vm.expectRevert(RentalEscrow.NothingToRelease.selector);
        vm.prank(stranger);
        escrow.releaseRent();

        vm.prank(tenant);
        escrow.releaseRent();
        assertEq(escrow.monthsReleased(), 2);
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT);
    }

    function test_releaseRent_afterDueDate_byAnyone() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(2);

        vm.warp(block.timestamp + escrow.RENT_PERIOD());
        assertEq(escrow.monthsDue(), 2);
        vm.prank(stranger);
        escrow.releaseRent();
        assertEq(escrow.monthsReleased(), 2);

        vm.warp(escrow.dueDate(2) - 1);
        vm.expectRevert(RentalEscrow.NothingToRelease.selector);
        escrow.releaseRent();

        vm.warp(escrow.dueDate(2));
        escrow.releaseRent();
        assertEq(escrow.monthsReleased(), 3);
        assertEq(usdt.balanceOf(landlord), 3 * RENT - FEE);
    }

    function test_releaseRent_unfundedMonthsNeverReleased() public {
        RentalEscrow escrow = _createAndFund();
        escrow.releaseRent();
        vm.warp(block.timestamp + 5 * escrow.RENT_PERIOD());
        vm.expectRevert(RentalEscrow.NothingToRelease.selector);
        escrow.releaseRent();
        // Deposit is untouched by rent logic.
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT);
    }

    function test_releaseRent_revertsBeforeFundingAndAfterSettlement() public {
        RentalEscrow escrow = _createLease();
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CREATED));
        escrow.releaseRent();

        escrow = _createAndFund();
        _proposeAndAccept(escrow, DEPOSIT);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.releaseRent();
    }

    function test_monthsDue_cappedAtTerm() public {
        RentalEscrow escrow = _createAndFund();
        vm.warp(block.timestamp + 100 * escrow.RENT_PERIOD());
        assertEq(escrow.monthsDue(), TERM);
        assertEq(_createLease().monthsDue(), 0);
    }

    // =============================================================================================
    // Protocol fee (once per lease, % of one month's rent, from the landlord's first payout)
    // =============================================================================================

    function test_fee_chargedOnceOnFirstRelease() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(2);
        assertFalse(escrow.feeCharged());

        vm.expectEmit(true, true, true, true, address(escrow));
        emit RentalEscrow.ProtocolFeePaid(treasury, FEE);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit RentalEscrow.RentReleased(stranger, 1, RENT - FEE, FEE);
        vm.prank(stranger);
        escrow.releaseRent();
        assertTrue(escrow.feeCharged());
        assertEq(FEE, 50 * UNIT); // 10% of one 500-token month
        assertEq(usdt.balanceOf(landlord), RENT - FEE);
        assertEq(usdt.balanceOf(treasury), FEE);

        // Later months are paid in full.
        vm.expectEmit(true, true, true, true, address(escrow));
        emit RentalEscrow.RentReleased(tenant, 2, 2 * RENT, 0);
        vm.prank(tenant);
        escrow.releaseRent();
        assertEq(usdt.balanceOf(landlord), 3 * RENT - FEE);
        assertEq(usdt.balanceOf(treasury), FEE);
    }

    function test_fee_isOneMonthBased_evenWhenReleasingManyMonthsAtOnce() public {
        RentalEscrow escrow = _createAndFund();
        vm.startPrank(tenant);
        escrow.payRent(TERM - 1);
        escrow.releaseRent(); // all 12 months, early
        vm.stopPrank();
        assertEq(usdt.balanceOf(treasury), FEE);
        assertEq(usdt.balanceOf(landlord), TERM * RENT - FEE);
        assertEq(usdt.balanceOf(address(escrow)), DEPOSIT); // deposit untouched
    }

    function test_fee_chargedInSettlementWhenNoRentReleasedYet_neverFromDeposit() public {
        RentalEscrow escrow = _createAndFund();
        uint256 tenantBefore = usdt.balanceOf(tenant);

        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit RentalEscrow.Settled(DEPOSIT, 0, RENT, 0, FEE, REPORT_HASH);
        vm.prank(landlord);
        escrow.accept(1);

        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT); // full deposit, no fee
        assertEq(usdt.balanceOf(landlord), RENT - FEE);
        assertEq(usdt.balanceOf(treasury), FEE);
    }

    function test_fee_roundsDown() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.rentAmount = 441_180_001; // 10% = 44,118,000.1 -> 44,118,000
        vm.prank(landlord);
        RentalEscrow escrow = RentalEscrow(factory.createLease(p));
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        vm.stopPrank();

        escrow.releaseRent();
        assertEq(usdt.balanceOf(treasury), 44_118_000);
        assertEq(usdt.balanceOf(landlord), 441_180_001 - 44_118_000);
    }

    function test_fee_zero_noTransferNoEvent() public {
        vm.prank(owner);
        factory.setFee(0, address(0));
        RentalEscrow escrow = _createAndFund();

        vm.recordLogs();
        escrow.releaseRent();
        assertEq(usdt.balanceOf(landlord), RENT);
        assertEq(usdt.balanceOf(treasury), 0);
        assertTrue(escrow.feeCharged());
        // Only Transfer(escrow -> landlord) and RentReleased: no ProtocolFeePaid.
        assertEq(vm.getRecordedLogs().length, 2);
    }

    function test_fee_snapshotAtCreation_recipientAndRateChangesOnlyAffectNewLeases() public {
        RentalEscrow oldLease = _createAndFund();
        vm.prank(owner);
        factory.setFee(500, stranger);
        RentalEscrow newLease = _createAndFund();

        oldLease.releaseRent();
        assertEq(usdt.balanceOf(treasury), FEE); // old rate, old recipient
        assertEq(usdt.balanceOf(stranger), 0);

        newLease.releaseRent();
        assertEq(usdt.balanceOf(stranger), (RENT * 500) / 10_000);
        assertEq(usdt.balanceOf(treasury), FEE);
    }

    // =============================================================================================
    // Evidence
    // =============================================================================================

    function test_addEvidence_storesHashes() public {
        RentalEscrow escrow = _createLease();
        bytes32 h1 = keccak256("checkin");
        bytes32 h2 = keccak256("checkout");

        vm.expectEmit(true, true, false, true, address(escrow));
        emit RentalEscrow.EvidenceAdded(RentalEscrow.EvidenceKind.CheckIn, h1, landlord);
        vm.prank(landlord);
        escrow.addEvidence(RentalEscrow.EvidenceKind.CheckIn, h1);

        vm.prank(tenant);
        escrow.addEvidence(RentalEscrow.EvidenceKind.CheckOut, h2);
        vm.prank(tenant);
        escrow.addEvidence(RentalEscrow.EvidenceKind.Other, keccak256("other"));

        assertEq(escrow.checkInHash(), h1);
        assertEq(escrow.checkOutHash(), h2);
    }

    function test_addEvidence_reverts() public {
        RentalEscrow escrow = _createLease();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, stranger));
        escrow.addEvidence(RentalEscrow.EvidenceKind.CheckIn, keccak256("x"));

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, arbiter));
        escrow.addEvidence(RentalEscrow.EvidenceKind.CheckIn, keccak256("x"));

        vm.prank(landlord);
        vm.expectRevert(RentalEscrow.InvalidAmount.selector);
        escrow.addEvidence(RentalEscrow.EvidenceKind.CheckIn, bytes32(0));

        vm.prank(landlord);
        escrow.cancel();
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CANCELLED));
        escrow.addEvidence(RentalEscrow.EvidenceKind.CheckIn, keccak256("x"));
    }

    // =============================================================================================
    // Proposals & mutual settlement
    // =============================================================================================

    function test_propose_storesProposal() public {
        RentalEscrow escrow = _createAndFund();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit RentalEscrow.SettlementProposed(landlord, 1, 800 * UNIT, 200 * UNIT, REPORT_HASH);
        vm.prank(landlord);
        escrow.propose(800 * UNIT, REPORT_HASH);

        RentalEscrow.Proposal memory p = escrow.proposal();
        assertEq(uint8(escrow.status()), uint8(MOVE_OUT));
        assertEq(p.tenantRefund, 800 * UNIT);
        assertEq(p.landlordClaim, 200 * UNIT);
        assertEq(p.reportHash, REPORT_HASH);
        assertEq(p.proposer, landlord);
        assertEq(p.nonce, 1);
        assertEq(p.proposedAt, block.timestamp);
    }

    function test_propose_reverts() public {
        RentalEscrow unfunded = _createLease();
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CREATED));
        unfunded.propose(DEPOSIT, REPORT_HASH);

        RentalEscrow escrow = _createAndFund();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, arbiter));
        escrow.propose(DEPOSIT, REPORT_HASH);

        vm.prank(tenant);
        vm.expectRevert(RentalEscrow.InvalidAmount.selector);
        escrow.propose(DEPOSIT + 1, REPORT_HASH);
    }

    function test_accept_settlesSplitAndRent() public {
        RentalEscrow escrow = _createAndFund();
        uint256 tenantBefore = usdt.balanceOf(tenant);

        vm.prank(tenant);
        escrow.propose(700 * UNIT, REPORT_HASH);
        vm.prank(landlord);
        escrow.accept(1);

        assertEq(uint8(escrow.status()), uint8(SETTLED));
        // Month 0 rent was due -> landlord (minus fee), plus the 300 claim.
        assertEq(usdt.balanceOf(landlord), RENT - FEE + 300 * UNIT);
        assertEq(usdt.balanceOf(treasury), FEE);
        assertEq(usdt.balanceOf(tenant), tenantBefore + 700 * UNIT);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_accept_refundsPrepaidRentNotYetDue() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(3); // months 0..3 funded
        uint256 tenantBefore = usdt.balanceOf(tenant);

        vm.warp(block.timestamp + escrow.RENT_PERIOD()); // months 0 and 1 due
        _proposeAndAccept(escrow, DEPOSIT);

        assertEq(usdt.balanceOf(landlord), 2 * RENT - FEE);
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT + 2 * RENT);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_settle_afterTenantReleasedEarly_noUnderflow() public {
        RentalEscrow escrow = _createAndFund();
        vm.startPrank(tenant);
        escrow.payRent(3);
        escrow.releaseRent(); // releases all 4 months early
        vm.stopPrank();
        assertEq(escrow.monthsReleased(), 4);

        uint256 tenantBefore = usdt.balanceOf(tenant);
        _proposeAndAccept(escrow, DEPOSIT);
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_accept_revertsForProposer() public {
        RentalEscrow escrow = _createAndFund();
        vm.startPrank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.expectRevert(RentalEscrow.ProposerCannotAccept.selector);
        escrow.accept(1);
        vm.stopPrank();
    }

    function test_accept_revertsForWrongCaller() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, stranger));
        escrow.accept(1);

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, arbiter));
        escrow.accept(1);
    }

    function test_accept_revertsWithoutProposal() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, ACTIVE));
        escrow.accept(0);
    }

    function test_accept_staleNonceAfterCounterProposal() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH); // nonce 1
        vm.prank(landlord);
        escrow.propose(500 * UNIT, REPORT_HASH); // counter, nonce 2

        // Landlord can no longer accept the tenant's old offer it just replaced, and tenant can't accept nonce 1.
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidNonce.selector, uint32(2), uint32(1)));
        escrow.accept(1);

        vm.prank(tenant);
        escrow.accept(2);
        assertEq(uint8(escrow.status()), uint8(SETTLED));
    }

    function test_doubleSettle_reverts() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.prank(landlord);
        escrow.accept(1);

        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.accept(1);

        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.claimTimeout();

        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.propose(DEPOSIT, REPORT_HASH);

        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.dispute();

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.resolve(0, REPORT_HASH);
    }

    function test_payRent_revertsDuringMoveOut() public {
        RentalEscrow escrow = _createAndFund();
        vm.startPrank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, MOVE_OUT));
        escrow.payRent(1);
        vm.stopPrank();
    }

    // =============================================================================================
    // Landlord-response timeout
    // =============================================================================================

    function test_claimTimeout_returnsFullDepositToTenant_notTheProposedSplit() public {
        RentalEscrow escrow = _createAndFund();
        escrow.releaseRent();
        uint256 tenantBefore = usdt.balanceOf(tenant);
        uint256 landlordBefore = usdt.balanceOf(landlord);

        // Tenant generously offers the landlord 300; the landlord never answers.
        vm.prank(tenant);
        escrow.propose(700 * UNIT, REPORT_HASH);
        uint64 deadline = uint64(vm.getBlockTimestamp() + WINDOW);
        assertEq(escrow.timeoutAt(), deadline);

        vm.warp(deadline);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit RentalEscrow.Settled(DEPOSIT, 0, 0, 0, 0, escrow.LANDLORD_TIMEOUT_BASIS());
        vm.prank(stranger);
        escrow.claimTimeout();

        assertEq(uint8(escrow.status()), uint8(SETTLED));
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT);
        assertEq(usdt.balanceOf(landlord), landlordBefore);
        assertEq(usdt.balanceOf(address(escrow)), 0);
        assertEq(escrow.timeoutAt(), 0);
    }

    function test_claimTimeout_revertsBeforeDeadline_succeedsExactlyAtDeadline() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        uint64 deadline = uint64(vm.getBlockTimestamp() + WINDOW);

        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.TimeoutNotReached.selector, deadline));
        escrow.claimTimeout();

        vm.warp(deadline - 1);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.TimeoutNotReached.selector, deadline));
        escrow.claimTimeout();

        vm.warp(deadline);
        escrow.claimTimeout();
        assertEq(uint8(escrow.status()), uint8(SETTLED));
    }

    function test_claimTimeout_doubleTriggerReverts() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        escrow.claimTimeout();

        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.claimTimeout();
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.accept(1);
    }

    function test_claimTimeout_releasedRentStays_dueRentToLandlord_prepaidRefunded() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(3); // months 0..3 funded
        vm.warp(escrow.dueDate(1));
        escrow.releaseRent(); // months 0,1 released
        uint256 landlordAfterRelease = usdt.balanceOf(landlord);
        assertEq(landlordAfterRelease, 2 * RENT - FEE);

        // Tenant proposes just before month 2 becomes due; the window spans that due date.
        vm.warp(escrow.dueDate(2) - 1 days);
        vm.prank(tenant);
        escrow.propose(0, REPORT_HASH);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        assertEq(escrow.monthsDue(), 2); // the rent clock stopped at the move-out
        uint256 tenantBefore = usdt.balanceOf(tenant);

        escrow.claimTimeout();

        // Months 2 and 3 were not due at the move-out -> tenant; released rent stays; full deposit -> tenant.
        assertEq(usdt.balanceOf(landlord), landlordAfterRelease); // fee was taken once, on month 0
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT + 2 * RENT);
        assertEq(usdt.balanceOf(treasury), FEE);
        assertEq(escrow.monthsReleased(), 2);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_claimTimeout_tenantCounterRestartsClock() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(landlord);
        escrow.propose(0, REPORT_HASH);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(tenant);
        escrow.propose(900 * UNIT, REPORT_HASH);
        uint64 deadline = uint64(vm.getBlockTimestamp() + WINDOW);
        assertEq(escrow.timeoutAt(), deadline);

        vm.warp(deadline - 1);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.TimeoutNotReached.selector, deadline));
        escrow.claimTimeout();
        vm.warp(deadline);
        escrow.claimTimeout();
        assertEq(uint8(escrow.status()), uint8(SETTLED));
    }

    function test_claimTimeout_notApplicableToLandlordProposal() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(landlord);
        escrow.propose(0, REPORT_HASH);
        assertEq(escrow.timeoutAt(), 0);

        vm.warp(vm.getBlockTimestamp() + 60 days);
        vm.expectRevert(RentalEscrow.TimeoutNotApplicable.selector);
        escrow.claimTimeout();
    }

    function test_claimTimeout_landlordCounterStopsClock() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.warp(vm.getBlockTimestamp() + WINDOW - 1 hours);
        vm.prank(landlord);
        escrow.propose(600 * UNIT, REPORT_HASH);

        vm.warp(vm.getBlockTimestamp() + WINDOW);
        vm.expectRevert(RentalEscrow.TimeoutNotApplicable.selector);
        escrow.claimTimeout();
    }

    function test_claimTimeout_landlordDisputeStopsClock() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.prank(landlord);
        escrow.dispute();

        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, DISPUTED));
        escrow.claimTimeout();
        assertEq(escrow.timeoutAt(), 0);
    }

    // =============================================================================================
    // Disputes
    // =============================================================================================

    function test_dispute_arbiterResolves() public {
        RentalEscrow escrow = _createAndFund();
        uint256 tenantBefore = usdt.balanceOf(tenant);

        vm.prank(tenant);
        escrow.dispute();
        assertEq(uint8(escrow.status()), uint8(DISPUTED));

        vm.prank(arbiter);
        escrow.resolve(400 * UNIT, keccak256("ruling"));

        assertEq(uint8(escrow.status()), uint8(SETTLED));
        assertEq(usdt.balanceOf(tenant), tenantBefore + 400 * UNIT);
        assertEq(usdt.balanceOf(landlord), RENT - FEE + 600 * UNIT);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_dispute_fromMoveOut() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(landlord);
        escrow.propose(0, REPORT_HASH);
        vm.prank(tenant);
        escrow.dispute();
        assertEq(uint8(escrow.status()), uint8(DISPUTED));

        // No more proposals or accepts while disputed.
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, DISPUTED));
        escrow.accept(1);
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, DISPUTED));
        escrow.propose(DEPOSIT, REPORT_HASH);
    }

    function test_dispute_rentStillReleasableWhileDisputed() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(landlord);
        escrow.dispute();
        escrow.releaseRent();
        assertEq(escrow.monthsReleased(), 1);
    }

    function test_dispute_reverts() public {
        RentalEscrow unfunded = _createLease();
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CREATED));
        unfunded.dispute();

        RentalEscrow escrow = _createAndFund();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, arbiter));
        escrow.dispute();

        vm.prank(tenant);
        escrow.dispute();
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, DISPUTED));
        escrow.dispute();
    }

    function test_resolve_reverts() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, ACTIVE));
        escrow.resolve(0, REPORT_HASH);

        vm.prank(tenant);
        escrow.dispute();

        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, landlord));
        escrow.resolve(0, REPORT_HASH);

        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.Unauthorized.selector, tenant));
        escrow.resolve(DEPOSIT, REPORT_HASH);

        vm.prank(arbiter);
        vm.expectRevert(RentalEscrow.InvalidAmount.selector);
        escrow.resolve(DEPOSIT + 1, REPORT_HASH);

        vm.prank(arbiter);
        escrow.resolve(DEPOSIT, REPORT_HASH);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.resolve(DEPOSIT, REPORT_HASH);
    }

    // =============================================================================================
    // Arbiter-deadline fallback
    // =============================================================================================

    function test_dispute_setsArbiterDeadline() public {
        RentalEscrow escrow = _createAndFund();
        assertEq(escrow.arbiterDeadline(), 0);
        assertEq(escrow.disputedAt(), 0);

        vm.warp(vm.getBlockTimestamp() + 3 days);
        vm.prank(tenant);
        escrow.dispute();
        assertEq(escrow.disputedAt(), vm.getBlockTimestamp());
        assertEq(escrow.arbiterDeadline(), vm.getBlockTimestamp() + ARB_WINDOW);

        vm.prank(arbiter);
        escrow.resolve(0, REPORT_HASH);
        assertEq(escrow.arbiterDeadline(), 0);
    }

    function test_claimArbiterTimeout_returnsFullDepositToTenant() public {
        RentalEscrow escrow = _createAndFund();
        escrow.releaseRent();
        vm.prank(landlord);
        escrow.propose(0, REPORT_HASH); // landlord claims the whole deposit
        vm.prank(tenant);
        escrow.dispute();
        uint64 deadline = escrow.arbiterDeadline();
        uint256 tenantBefore = usdt.balanceOf(tenant);
        uint256 landlordBefore = usdt.balanceOf(landlord);

        vm.warp(deadline);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit RentalEscrow.Settled(DEPOSIT, 0, 0, 0, 0, escrow.ARBITER_TIMEOUT_BASIS());
        vm.prank(stranger);
        escrow.claimArbiterTimeout();

        assertEq(uint8(escrow.status()), uint8(SETTLED));
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT);
        assertEq(usdt.balanceOf(landlord), landlordBefore);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_claimArbiterTimeout_revertsBeforeDeadline_succeedsExactlyAtDeadline() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(landlord);
        escrow.dispute();
        uint64 deadline = uint64(vm.getBlockTimestamp() + ARB_WINDOW);
        assertEq(escrow.arbiterDeadline(), deadline);

        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.TimeoutNotReached.selector, deadline));
        escrow.claimArbiterTimeout();

        vm.warp(deadline - 1);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.TimeoutNotReached.selector, deadline));
        escrow.claimArbiterTimeout();

        vm.warp(deadline);
        escrow.claimArbiterTimeout();
        assertEq(uint8(escrow.status()), uint8(SETTLED));
    }

    function test_claimArbiterTimeout_doubleTriggerReverts() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.dispute();
        vm.warp(escrow.arbiterDeadline());
        escrow.claimArbiterTimeout();

        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.claimArbiterTimeout();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, SETTLED));
        escrow.resolve(0, REPORT_HASH);
    }

    function test_claimArbiterTimeout_revertsWhenNotDisputed() public {
        RentalEscrow escrow = _createAndFund();
        vm.warp(vm.getBlockTimestamp() + 365 days);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, ACTIVE));
        escrow.claimArbiterTimeout();

        vm.prank(tenant);
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, MOVE_OUT));
        escrow.claimArbiterTimeout();

        RentalEscrow unfunded = _createLease();
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.InvalidStatus.selector, CREATED));
        unfunded.claimArbiterTimeout();
    }

    function test_resolve_worksUntilDeadline_revertsExactlyAtDeadline() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.dispute();
        uint64 deadline = escrow.arbiterDeadline();

        vm.warp(deadline);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(RentalEscrow.ArbiterDeadlinePassed.selector, deadline));
        escrow.resolve(0, REPORT_HASH);

        vm.warp(deadline - 1);
        vm.prank(arbiter);
        escrow.resolve(0, REPORT_HASH);
        assertEq(uint8(escrow.status()), uint8(SETTLED));
    }

    function test_claimArbiterTimeout_releasedRentStays_dueRentToLandlord_prepaidRefunded() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(3); // months 0..3 funded
        vm.warp(escrow.dueDate(1));
        escrow.releaseRent(); // months 0,1 released
        uint256 landlordAfterRelease = usdt.balanceOf(landlord);

        // Dispute shortly before month 2 is due; the arbiter window spans that due date.
        vm.warp(escrow.dueDate(2) - 5 days);
        vm.prank(landlord);
        escrow.dispute();
        // The rent clock stopped at the dispute: month 2 never becomes due, nothing more to release.
        vm.warp(escrow.dueDate(2));
        vm.expectRevert(RentalEscrow.NothingToRelease.selector);
        escrow.releaseRent();

        vm.warp(escrow.arbiterDeadline());
        uint256 tenantBefore = usdt.balanceOf(tenant);
        escrow.claimArbiterTimeout();

        // Released rent stays with the landlord; prepaid months 2,3 + the full deposit go back to the tenant.
        assertEq(usdt.balanceOf(landlord), landlordAfterRelease);
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT + 2 * RENT);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_claimArbiterTimeout_paysRentDueAtDisputeToLandlord() public {
        RentalEscrow escrow = _createAndFund();
        vm.prank(tenant);
        escrow.payRent(1); // months 0,1 funded, nothing released
        vm.warp(escrow.dueDate(1) + 2 days); // month 1 is due
        vm.prank(tenant);
        escrow.dispute();
        vm.warp(escrow.arbiterDeadline());
        uint256 tenantBefore = usdt.balanceOf(tenant);

        escrow.claimArbiterTimeout();

        assertEq(usdt.balanceOf(landlord), 2 * RENT - FEE);
        assertEq(usdt.balanceOf(tenant), tenantBefore + DEPOSIT);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    // =============================================================================================
    // Reentrancy
    // =============================================================================================

    function test_reentrancy_blockedOnPayout() public {
        ReentrantToken re = new ReentrantToken();
        EscrowFactory f =
            new EscrowFactory(IERC20(address(re)), owner, 0, address(0), address(0), NO_CAP, NO_CAP, NO_CAP);
        vm.prank(landlord);
        RentalEscrow escrow = RentalEscrow(f.createLease(_params()));

        re.mint(tenant, 10_000 * UNIT);
        vm.startPrank(tenant);
        re.approve(address(escrow), type(uint256).max);
        escrow.fund();
        escrow.propose(DEPOSIT, REPORT_HASH);
        vm.stopPrank();

        // Every outgoing transfer now calls back into escrow.releaseRent().
        re.setTarget(address(escrow));
        vm.prank(landlord);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        escrow.accept(1);

        vm.prank(stranger);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        escrow.releaseRent();

        // Funds stay safe and the lease is still settleable once the hostile hook is gone.
        re.setTarget(address(0));
        vm.prank(landlord);
        escrow.accept(1);
        assertEq(re.balanceOf(address(escrow)), 0);
    }

    // =============================================================================================
    // Fuzz: conservation of funds
    // =============================================================================================

    /// Whatever the split, time and prepaid months, every token that entered the escrow leaves it
    /// to exactly the landlord, tenant and fee recipient.
    function testFuzz_settlementConservesFunds(
        uint256 tenantRefund,
        uint32 extraMonths,
        uint256 elapsed,
        uint8 path
    ) public {
        tenantRefund = bound(tenantRefund, 0, DEPOSIT);
        extraMonths = uint32(bound(extraMonths, 0, TERM - 1));
        elapsed = bound(elapsed, 0, 400 days);

        RentalEscrow escrow = _createAndFund();
        if (extraMonths > 0) {
            vm.prank(tenant);
            escrow.payRent(extraMonths);
        }
        uint256 tenantStart = usdt.balanceOf(tenant) + DEPOSIT + RENT * (1 + extraMonths);
        vm.warp(vm.getBlockTimestamp() + elapsed);

        path = path % 4;
        if (path == 0) {
            vm.prank(landlord);
            escrow.dispute();
            vm.prank(arbiter);
            escrow.resolve(tenantRefund, REPORT_HASH);
        } else if (path == 1) {
            vm.prank(landlord);
            escrow.propose(tenantRefund, REPORT_HASH);
            vm.prank(tenant);
            escrow.accept(1);
        } else if (path == 2) {
            vm.prank(tenant);
            escrow.propose(tenantRefund, REPORT_HASH);
            vm.warp(vm.getBlockTimestamp() + WINDOW);
            escrow.claimTimeout();
            tenantRefund = DEPOSIT;
        } else {
            vm.prank(landlord);
            escrow.dispute();
            vm.warp(vm.getBlockTimestamp() + ARB_WINDOW);
            escrow.claimArbiterTimeout();
            tenantRefund = DEPOSIT;
        }

        uint256 out = usdt.balanceOf(landlord) + usdt.balanceOf(tenant) + usdt.balanceOf(treasury);
        assertEq(usdt.balanceOf(address(escrow)), 0);
        assertEq(out, tenantStart);
        assertGe(usdt.balanceOf(tenant), tenantStart - DEPOSIT - RENT * (1 + extraMonths) + tenantRefund);
    }

    // =============================================================================================
    // Helpers
    // =============================================================================================

    function _proposeAndAccept(RentalEscrow escrow, uint256 tenantRefund) internal {
        vm.prank(tenant);
        escrow.propose(tenantRefund, REPORT_HASH);
        uint32 nonce = escrow.proposal().nonce; // read first: vm.prank applies to the next call only
        vm.prank(landlord);
        escrow.accept(nonce);
    }
}
