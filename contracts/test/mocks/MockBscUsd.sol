// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test/rehearsal stand-in for BSC-USD (BSC mainnet USDT, 18 decimals) with an open faucet.
/// @dev Name, symbol and decimals are pure, so the runtime code alone works when a rehearsal puts it at the real
/// BSC-USD address with `anvil_setCode` (no constructor storage needed).
contract MockBscUsd is ERC20 {
    constructor() ERC20("", "") {}

    function name() public pure override returns (string memory) {
        return "Tether USD";
    }

    function symbol() public pure override returns (string memory) {
        return "USDT";
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
