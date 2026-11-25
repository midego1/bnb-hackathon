// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowFactory} from "../../src/EscrowFactory.sol";
import {RentalEscrow} from "../../src/RentalEscrow.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockBscUsd} from "../mocks/MockBscUsd.sol";

abstract contract BaseTest is Test {
    /// MockUSDT (6 decimals), or MockBscUsd (18) when a suite overrides {_decimals}: same faucet + ERC-20 calls.
    MockUSDT internal usdt;
    EscrowFactory internal factory;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal landlord = makeAddr("landlord");
    address internal tenant = makeAddr("tenant");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal disputeDesk = makeAddr("disputeDesk");

    // Amounts follow the token's decimals (set in setUp): 1 UNIT = 1 token.
    uint256 internal UNIT;
    uint256 internal RENT; // 500 tokens / month
    uint256 internal DEPOSIT; // 2 months' rent
    uint256 internal FEE; // 10% of one month's rent = 50 tokens
    uint32 internal constant TERM = 12;
    uint32 internal constant WINDOW = 5 days; // landlord-response window (non-default on purpose)
    uint32 internal constant ARB_WINDOW = 10 days; // arbiter window (non-default on purpose)
    uint16 internal constant FEE_BPS = 1_000; // 10% of one month's rent, once per lease
    bytes32 internal constant LEASE_HASH = keccak256("lease.pdf");
    bytes32 internal constant REPORT_HASH = keccak256("ai-report.json");

    function setUp() public virtual {
        // Lease timestamps start at a realistic date so `startTime != 0` checks are meaningful.
        vm.warp(1_790_000_000);
        usdt = _decimals() == 6 ? new MockUSDT() : MockUSDT(address(new MockBscUsd()));
        assertEq(usdt.decimals(), _decimals());
        UNIT = 10 ** _decimals();
        (RENT, DEPOSIT) = (500 * UNIT, 1_000 * UNIT);
        FEE = (RENT * FEE_BPS) / 10_000;
        factory = new EscrowFactory(IERC20(address(usdt)), owner, FEE_BPS, treasury, disputeDesk);
        usdt.faucet(tenant, 10_000 * UNIT);
    }

    /// @dev Token decimals for the suite: 6 (MockUSDT, testnet) by default; 18 (BSC-USD) in the *18Decimals suites.
    function _decimals() internal pure virtual returns (uint8) {
        return 6;
    }

    function _params() internal view returns (EscrowFactory.LeaseParams memory) {
        return EscrowFactory.LeaseParams({
            tenant: tenant,
            arbiter: arbiter,
            rentAmount: RENT,
            depositAmount: DEPOSIT,
            termMonths: TERM,
            responseWindow: WINDOW,
            arbiterWindow: ARB_WINDOW,
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
}
