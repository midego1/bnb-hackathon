// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";

contract EscrowFactoryTest is BaseTest {
    function test_createLease_initializesTermsAndIndexes() public {
        RentalEscrow escrow = _createLease();

        RentalEscrow.Terms memory t = escrow.terms();
        assertEq(address(t.token), address(usdt));
        assertEq(t.landlord, landlord);
        assertEq(t.tenant, tenant);
        assertEq(t.arbiter, arbiter);
        assertEq(t.rentAmount, RENT);
        assertEq(t.depositAmount, DEPOSIT);
        assertEq(t.termPeriods, TERM);
        assertEq(t.rentPeriod, PERIOD);
        assertEq(t.responseWindow, WINDOW);
        assertEq(t.arbiterWindow, ARB_WINDOW);
        assertEq(t.leaseHash, LEASE_HASH);
        assertEq(t.feeBps, FEE_BPS);
        assertEq(t.feeRecipient, treasury);
        assertEq(uint8(escrow.status()), uint8(RentalEscrow.Status.Created));

        assertTrue(factory.isLease(address(escrow)));
        assertEq(factory.leaseCount(), 1);
        assertEq(factory.leasesByLandlord(landlord)[0], address(escrow));
        assertEq(factory.leasesByTenant(tenant)[0], address(escrow));
        assertEq(factory.leasesByArbiter(arbiter)[0], address(escrow));
    }

    function test_createLease_emitsEvent() public {
        vm.expectEmit(false, true, true, true, address(factory));
        emit EscrowFactory.LeaseCreated(
            address(0), landlord, tenant, arbiter, RENT, DEPOSIT, TERM, PERIOD, WINDOW, ARB_WINDOW, LEASE_HASH
        );
        _createLease();
    }

    function test_createLease_revertsOnZeroAddresses() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.tenant = address(0);
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        factory.createLease(p);

        // No explicit arbiter and the default (dispute desk) disabled.
        vm.prank(owner);
        factory.setDefaultArbiter(address(0));
        p = _params();
        p.arbiter = address(0);
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        factory.createLease(p);
    }

    // --- Default arbiter (KeyScrow dispute desk) -------------------------------------------------

    function test_createLease_zeroArbiterUsesDisputeDesk() public {
        assertEq(factory.defaultArbiter(), disputeDesk);
        EscrowFactory.LeaseParams memory p = _params();
        p.arbiter = address(0);

        vm.expectEmit(false, true, true, true, address(factory));
        emit EscrowFactory.LeaseCreated(
            address(0),
            landlord,
            tenant,
            disputeDesk,
            RENT,
            DEPOSIT,
            TERM,
            PERIOD,
            WINDOW,
            ARB_WINDOW,
            LEASE_HASH
        );
        vm.prank(landlord);
        RentalEscrow escrow = RentalEscrow(factory.createLease(p));

        assertEq(escrow.terms().arbiter, disputeDesk);
        assertEq(factory.leasesByArbiter(disputeDesk)[0], address(escrow));
        assertEq(factory.leasesByArbiter(address(0)).length, 0);
    }

    function test_createLease_landlordMayNameOwnArbiter() public {
        RentalEscrow escrow = _createLease(); // _params() names `arbiter`
        assertEq(escrow.terms().arbiter, arbiter);
        assertEq(factory.leasesByArbiter(disputeDesk).length, 0);
    }

    function test_createLease_defaultArbiterMustDifferFromParties() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.arbiter = address(0);

        vm.prank(owner);
        factory.setDefaultArbiter(landlord);
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLease(p);

        vm.prank(owner);
        factory.setDefaultArbiter(tenant);
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLease(p);
    }

    function test_setDefaultArbiter_onlyOwner_emits_affectsOnlyNewLeases() public {
        RentalEscrow before = RentalEscrow(_createDefaultArbiterLease());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setDefaultArbiter(stranger);

        vm.expectEmit(true, true, true, true, address(factory));
        emit EscrowFactory.DefaultArbiterUpdated(stranger);
        vm.prank(owner);
        factory.setDefaultArbiter(stranger);
        assertEq(factory.defaultArbiter(), stranger);

        RentalEscrow afterChange = RentalEscrow(_createDefaultArbiterLease());
        assertEq(before.terms().arbiter, disputeDesk);
        assertEq(afterChange.terms().arbiter, stranger);
    }

    function _createDefaultArbiterLease() internal returns (address) {
        EscrowFactory.LeaseParams memory p = _params();
        p.arbiter = address(0);
        vm.prank(landlord);
        return factory.createLease(p);
    }

    function test_createLease_revertsWhenRolesOverlap() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.tenant = landlord;
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLease(p);

        p = _params();
        p.arbiter = landlord;
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLease(p);

        p = _params();
        p.arbiter = tenant;
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.RolesNotDistinct.selector);
        factory.createLease(p);
    }

    function test_createLease_revertsOnZeroAmounts() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.rentAmount = 0;
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.InvalidAmount.selector);
        factory.createLease(p);

        p = _params();
        p.depositAmount = 0;
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.InvalidAmount.selector);
        factory.createLease(p);
    }

    function test_createLease_revertsOnInvalidTerm() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.termPeriods = 0;
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidTerm.selector, uint32(0)));
        factory.createLease(p);

        p.termPeriods = 61;
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidTerm.selector, uint32(61)));
        factory.createLease(p);
    }

    function test_createLease_rentPeriod_weeklyTwoWeeklyMonthly_zeroIsMonthly() public {
        EscrowFactory.LeaseParams memory p = _params();
        vm.startPrank(landlord);
        p.rentPeriod = 0;
        assertEq(RentalEscrow(factory.createLease(p)).terms().rentPeriod, 30 days);
        uint32[3] memory ok = [uint32(7 days), 14 days, 30 days];
        for (uint256 i; i < ok.length; ++i) {
            p.rentPeriod = ok[i];
            assertEq(RentalEscrow(factory.createLease(p)).terms().rentPeriod, ok[i]);
        }
        uint32[4] memory bad = [uint32(1), 1 days, 15 days, 31 days];
        for (uint256 i; i < bad.length; ++i) {
            p.rentPeriod = bad[i];
            vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidRentPeriod.selector, bad[i]));
            factory.createLease(p);
        }
        vm.stopPrank();
    }

    function test_createLease_revertsOnInvalidResponseWindow() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.responseWindow = 1 days - 1;
        vm.prank(landlord);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowFactory.InvalidResponseWindow.selector, p.responseWindow)
        );
        factory.createLease(p);

        p.responseWindow = 60 days + 1;
        vm.prank(landlord);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowFactory.InvalidResponseWindow.selector, p.responseWindow)
        );
        factory.createLease(p);
    }

    function test_createLease_zeroWindowsUseDefaults() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.responseWindow = 0;
        p.arbiterWindow = 0;

        vm.expectEmit(false, true, true, true, address(factory));
        emit EscrowFactory.LeaseCreated(
            address(0), landlord, tenant, arbiter, RENT, DEPOSIT, TERM, PERIOD, 7 days, 14 days, LEASE_HASH
        );
        vm.prank(landlord);
        RentalEscrow escrow = RentalEscrow(factory.createLease(p));

        RentalEscrow.Terms memory t = escrow.terms();
        assertEq(t.responseWindow, factory.DEFAULT_RESPONSE_WINDOW());
        assertEq(t.arbiterWindow, factory.DEFAULT_ARBITER_WINDOW());
        assertEq(t.responseWindow, 7 days);
        assertEq(t.arbiterWindow, 14 days);
    }

    function test_createLease_revertsOnInvalidArbiterWindow() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.arbiterWindow = 1 days - 1;
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidArbiterWindow.selector, p.arbiterWindow));
        factory.createLease(p);

        p.arbiterWindow = 90 days + 1;
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidArbiterWindow.selector, p.arbiterWindow));
        factory.createLease(p);

        // Bounds are inclusive.
        p.arbiterWindow = 90 days;
        vm.prank(landlord);
        assertEq(RentalEscrow(factory.createLease(p)).terms().arbiterWindow, 90 days);
        p.arbiterWindow = 1 days;
        vm.prank(landlord);
        assertEq(RentalEscrow(factory.createLease(p)).terms().arbiterWindow, 1 days);
    }

    function test_constructor_revertsOnBadConfig() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(IERC20(address(0)), owner, 0, address(0), address(0), NO_CAP, NO_CAP, NO_CAP);

        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.FeeTooHigh.selector, uint16(1001)));
        new EscrowFactory(IERC20(address(usdt)), owner, 1001, treasury, address(0), NO_CAP, NO_CAP, NO_CAP);

        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(IERC20(address(usdt)), owner, 10, address(0), address(0), NO_CAP, NO_CAP, NO_CAP);

        // Zero fee without a recipient is fine.
        EscrowFactory f = new EscrowFactory(
            IERC20(address(usdt)), owner, 0, address(0), address(0), NO_CAP, NO_CAP, NO_CAP
        );
        assertEq(f.feeBps(), 0);
    }

    function test_setFee_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setFee(10, treasury);

        vm.prank(owner);
        factory.setFee(1_000, treasury); // cap is inclusive
        assertEq(factory.feeBps(), 1_000);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.FeeTooHigh.selector, uint16(1001)));
        factory.setFee(1001, treasury);
    }

    function test_setFee_emitsAndAllowsZero() public {
        vm.expectEmit(true, true, true, true, address(factory));
        emit EscrowFactory.FeeUpdated(250, stranger);
        vm.prank(owner);
        factory.setFee(250, stranger);
        assertEq(factory.feeRecipient(), stranger);

        vm.prank(owner);
        factory.setFee(0, address(0));
        assertEq(factory.feeBps(), 0);

        vm.prank(owner);
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        factory.setFee(1, address(0));
    }

    function test_setFee_doesNotAffectExistingLeases() public {
        RentalEscrow before = _createLease();
        vm.prank(owner);
        factory.setFee(100, stranger);
        RentalEscrow afterChange = _createLease();

        assertEq(before.terms().feeBps, FEE_BPS);
        assertEq(before.terms().feeRecipient, treasury);
        assertEq(afterChange.terms().feeBps, 100);
        assertEq(afterChange.terms().feeRecipient, stranger);
    }

    function test_leases_pagination() public {
        address[] memory created = new address[](5);
        for (uint256 i; i < 5; ++i) {
            created[i] = address(_createLease());
        }
        address[] memory page = factory.leases(1, 3);
        assertEq(page.length, 3);
        assertEq(page[0], created[1]);
        assertEq(page[2], created[3]);

        assertEq(factory.leases(4, 10).length, 1);
        assertEq(factory.leases(5, 10).length, 0);
        assertEq(factory.leases(100, 1).length, 0);
    }

    function test_implementation_cannotBeInitialized() public {
        RentalEscrow impl = RentalEscrow(factory.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(_dummyTerms(), landlord);
    }

    function test_clone_cannotBeReinitialized() public {
        RentalEscrow escrow = _createLease();
        RentalEscrow.Terms memory t = _dummyTerms();
        t.landlord = stranger;
        vm.prank(stranger);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        escrow.initialize(t, stranger);
    }

    function _dummyTerms() internal view returns (RentalEscrow.Terms memory) {
        return RentalEscrow.Terms({
            token: IERC20(address(usdt)),
            landlord: landlord,
            tenant: tenant,
            arbiter: arbiter,
            rentAmount: RENT,
            depositAmount: DEPOSIT,
            termPeriods: TERM,
            rentPeriod: PERIOD,
            responseWindow: WINDOW,
            arbiterWindow: ARB_WINDOW,
            leaseHash: LEASE_HASH,
            feeBps: 0,
            feeRecipient: address(0)
        });
    }
    // =============================================================================================
    // Pilot caps (mainnet pilot): per-lease deposit / rent, total value held by all escrows
    // =============================================================================================

    function _fund(RentalEscrow escrow) internal {
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        vm.stopPrank();
    }

    function test_caps_unlimitedByDefault_onlyOwnerSets_emits() public {
        assertEq(factory.maxDeposit(), NO_CAP);
        assertEq(factory.maxRentPerPeriod(), NO_CAP);
        assertEq(factory.maxActiveValue(), NO_CAP);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setCaps(1, 1, 1);

        vm.expectEmit(true, true, true, true, address(factory));
        emit EscrowFactory.CapsUpdated(5, 2, 25);
        vm.prank(owner);
        factory.setCaps(5, 2, 25);
        assertEq(factory.maxDeposit(), 5);
        assertEq(factory.maxRentPerPeriod(), 2);
        assertEq(factory.maxActiveValue(), 25);

        vm.prank(owner);
        factory.setCaps(50, 20, 250); // raising works the same way
        assertEq(factory.maxActiveValue(), 250);
    }

    function test_caps_createLeaseRevertsAboveDepositOrRentCap() public {
        vm.prank(owner);
        factory.setCaps(DEPOSIT - 1, RENT - 1, NO_CAP);
        vm.startPrank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.DepositAboveCap.selector, DEPOSIT, DEPOSIT - 1));
        factory.createLease(_params());
        EscrowFactory.LeaseParams memory p = _params();
        p.depositAmount = DEPOSIT - 1;
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.RentAboveCap.selector, RENT, RENT - 1));
        factory.createLease(p);
        p.rentAmount = RENT - 1; // exactly at both caps
        factory.createLease(p);
        vm.stopPrank();
    }

    function test_caps_fundAndPayRentRevertAboveActiveValueCap_payoutsFreeRoom() public {
        vm.prank(owner);
        factory.setCaps(NO_CAP, NO_CAP, DEPOSIT + 2 * RENT);
        RentalEscrow a = _createLease();
        RentalEscrow b = _createLease();

        _fund(a);
        assertEq(factory.activeValue(), DEPOSIT + RENT);
        vm.startPrank(tenant);
        usdt.approve(address(b), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                RentalEscrow.ActiveValueAboveCap.selector, 2 * (DEPOSIT + RENT), DEPOSIT + 2 * RENT
            )
        );
        b.fund();
        a.payRent(1); // fits exactly
        vm.expectRevert(
            abi.encodeWithSelector(
                RentalEscrow.ActiveValueAboveCap.selector, DEPOSIT + 3 * RENT, DEPOSIT + 2 * RENT
            )
        );
        a.payRent(1);
        vm.stopPrank();

        a.releaseRent(); // month 0 paid out
        assertEq(factory.activeValue(), DEPOSIT + RENT);
        vm.prank(tenant);
        a.propose(DEPOSIT, REPORT_HASH);
        vm.prank(landlord);
        a.accept(1);
        assertEq(factory.activeValue(), 0);
        _fund(b); // room again
        assertEq(factory.activeValue(), DEPOSIT + RENT);
    }

    function test_caps_loweringBelowActiveValueNeverBlocksPayouts() public {
        RentalEscrow a = _createAndFund();
        vm.prank(tenant);
        a.payRent(2);
        vm.prank(owner);
        factory.setCaps(0, 0, 0); // emergency stop: no new leases, no new funding

        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.DepositAboveCap.selector, DEPOSIT, 0));
        factory.createLease(_params());

        a.releaseRent();
        vm.prank(landlord);
        a.dispute();
        vm.warp(a.arbiterDeadline());
        a.claimArbiterTimeout();
        assertEq(factory.activeValue(), 0);
        assertEq(usdt.balanceOf(address(a)), 0);
    }

    function test_valueBook_onlyLeases() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.NotLease.selector, stranger));
        factory.lockValue(1);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.NotLease.selector, stranger));
        factory.unlockValue(1);
        vm.stopPrank();
    }
}
