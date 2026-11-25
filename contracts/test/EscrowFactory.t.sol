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
        assertEq(t.termMonths, TERM);
        assertEq(t.responseWindow, WINDOW);
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
            address(0), landlord, tenant, arbiter, RENT, DEPOSIT, TERM, WINDOW, LEASE_HASH
        );
        _createLease();
    }

    function test_createLease_revertsOnZeroAddresses() public {
        EscrowFactory.LeaseParams memory p = _params();
        p.tenant = address(0);
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        factory.createLease(p);

        p = _params();
        p.arbiter = address(0);
        vm.prank(landlord);
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        factory.createLease(p);
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
        p.termMonths = 0;
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidTerm.selector, uint32(0)));
        factory.createLease(p);

        p.termMonths = 61;
        vm.prank(landlord);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.InvalidTerm.selector, uint32(61)));
        factory.createLease(p);
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

    function test_constructor_revertsOnBadConfig() public {
        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(IERC20(address(0)), owner, 0, address(0));

        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.FeeTooHigh.selector, uint16(101)));
        new EscrowFactory(IERC20(address(usdt)), owner, 101, treasury);

        vm.expectRevert(EscrowFactory.ZeroAddress.selector);
        new EscrowFactory(IERC20(address(usdt)), owner, 10, address(0));

        // Zero fee without a recipient is fine.
        EscrowFactory f = new EscrowFactory(IERC20(address(usdt)), owner, 0, address(0));
        assertEq(f.feeBps(), 0);
    }

    function test_setFee_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setFee(10, treasury);

        vm.prank(owner);
        factory.setFee(100, treasury);
        assertEq(factory.feeBps(), 100);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EscrowFactory.FeeTooHigh.selector, uint16(101)));
        factory.setFee(101, treasury);
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
        impl.initialize(_dummyTerms());
    }

    function test_clone_cannotBeReinitialized() public {
        RentalEscrow escrow = _createLease();
        RentalEscrow.Terms memory t = _dummyTerms();
        t.landlord = stranger;
        vm.prank(stranger);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        escrow.initialize(t);
    }

    function _dummyTerms() internal view returns (RentalEscrow.Terms memory) {
        return RentalEscrow.Terms({
            token: IERC20(address(usdt)),
            landlord: landlord,
            tenant: tenant,
            arbiter: arbiter,
            rentAmount: RENT,
            depositAmount: DEPOSIT,
            termMonths: TERM,
            responseWindow: WINDOW,
            leaseHash: LEASE_HASH,
            feeBps: 0,
            feeRecipient: address(0)
        });
    }
}
