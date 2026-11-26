// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAtlasFeed
/// @notice Local-anvil stand-in for an Atlas push feed (AggregatorV3 shape, 18 decimals). Anyone can set the answer.
/// @dev Never deploy outside a local chain.
contract MockAtlasFeed {
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 answer_) {
        set(answer_);
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    /// @notice New answer, stamped with the current block time.
    function set(int256 answer_) public {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
