// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT
/// @notice Testnet-only stablecoin stand-in (6 decimals, like USDT). Anyone can mint via the faucet.
/// @dev Never deploy to mainnet. This is not a project token; it only mimics an existing stablecoin for demos.
contract MockUSDT is ERC20 {
    /// @notice Max amount a single faucet call can mint (10,000 mUSDT).
    uint256 public constant FAUCET_LIMIT = 10_000e6;

    error FaucetLimitExceeded(uint256 requested, uint256 limit);

    constructor() ERC20("Mock USDT", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint test tokens to `to`. Capped per call to keep demo balances sane.
    function faucet(address to, uint256 amount) external {
        if (amount > FAUCET_LIMIT) revert FaucetLimitExceeded(amount, FAUCET_LIMIT);
        _mint(to, amount);
    }
}
