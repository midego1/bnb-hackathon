// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RentalEscrowTest} from "./RentalEscrow.t.sol";

/// Every escrow flow of RentalEscrowTest again, with an 18-decimal token (BSC-USD on BSC mainnet).
contract RentalEscrow18DecimalsTest is RentalEscrowTest {
    function _decimals() internal pure override returns (uint8) {
        return 18;
    }
}

/// ...with weekly rent and an 18-decimal token (the mainnet pilot's likely setup).
contract RentalEscrowWeekly18DecimalsTest is RentalEscrow18DecimalsTest {
    function _rentPeriod() internal pure override returns (uint32) {
        return 7 days;
    }
}

/// ...with rent every two weeks (MockUSDT, 6 decimals).
contract RentalEscrowTwoWeeklyTest is RentalEscrowTest {
    function _rentPeriod() internal pure override returns (uint32) {
        return 14 days;
    }
}
