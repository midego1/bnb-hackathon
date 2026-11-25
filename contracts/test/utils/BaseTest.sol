// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowFactory} from "../../src/EscrowFactory.sol";
import {RentalEscrow} from "../../src/RentalEscrow.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";

abstract contract BaseTest is Test {
    MockUSDT internal usdt;
    EscrowFactory internal factory;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal landlord = makeAddr("landlord");
    address internal tenant = makeAddr("tenant");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant RENT = 500e6; // 500 mUSDT / month
    uint256 internal constant DEPOSIT = 1_000e6; // 2 months' rent
    uint32 internal constant TERM = 12;
    uint32 internal constant WINDOW = 7 days;
    uint16 internal constant FEE_BPS = 50; // 0.5%
    bytes32 internal constant LEASE_HASH = keccak256("lease.pdf");
    bytes32 internal constant REPORT_HASH = keccak256("ai-report.json");

    function setUp() public virtual {
        // Lease timestamps start at a realistic date so `startTime != 0` checks are meaningful.
        vm.warp(1_790_000_000);
        usdt = new MockUSDT();
        factory = new EscrowFactory(IERC20(address(usdt)), owner, FEE_BPS, treasury);
        usdt.faucet(tenant, 10_000e6);
    }

    function _params() internal view returns (EscrowFactory.LeaseParams memory) {
        return EscrowFactory.LeaseParams({
            tenant: tenant,
            arbiter: arbiter,
            rentAmount: RENT,
            depositAmount: DEPOSIT,
            termMonths: TERM,
            responseWindow: WINDOW,
            leaseHash: LEASE_HASH
        });
    }

    function _createLease() internal returns (RentalEscrow escrow) {
        vm.prank(landlord);
        escrow = RentalEscrow(factory.createLease(_params()));
    }

    function _createAndFund() internal returns (RentalEscrow escrow) {
        escrow = _createLease();
        vm.startPrank(tenant);
        usdt.approve(address(escrow), type(uint256).max);
        escrow.fund();
        vm.stopPrank();
    }

    function _fee(uint256 gross) internal pure returns (uint256) {
        return (gross * FEE_BPS) / 10_000;
    }
}
