// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RentalEscrowTest} from "./RentalEscrow.t.sol";

/// Every escrow flow of RentalEscrowTest again, with an 18-decimal token (BSC-USD on BSC mainnet).
contract RentalEscrow18DecimalsTest is RentalEscrowTest {
    function _decimals() internal pure override returns (uint8) {
        return 18;
    }
}
