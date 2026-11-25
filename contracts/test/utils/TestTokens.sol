// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReenterTarget {
    function releaseRent() external;
}

/// @dev Token that tries to re-enter the escrow on every outgoing transfer.
contract ReentrantToken is ERC20 {
    address public target;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address t) external {
        target = t;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && from == target) {
            IReenterTarget(target).releaseRent();
        }
    }
}

/// @dev Token that burns 1% on transfer, to exercise the escrow's shortfall check.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("FeeOnTransfer", "FOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 burnt = value / 100;
            super._update(from, address(0), burnt);
            value -= burnt;
        }
        super._update(from, to, value);
    }
}
