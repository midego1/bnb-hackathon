// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The part of an Atlas push feed (Chainlink AggregatorV3-compatible) this contract reads.
interface IAtlasFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @dev MockUSDT: anyone can mint up to its FAUCET_LIMIT per call.
interface IFaucetToken {
    function decimals() external view returns (uint8);
    function faucet(address to, uint256 amount) external;
}

/// @title AtlasSwapGuard
/// @notice TESTNET DEMO swap for "Pay with BNB": sells test BNB for test mUSDT at the Atlas BNB/USD push-feed price
/// (1 mUSDT = 1 USD). PancakeSwap has no pool for our MockUSDT on BSC testnet, so this contract stands in for the
/// router with the two PancakeSwap V2 router functions the app calls. It refuses a stale or non-positive Atlas answer
/// and an output below the caller's `amountOutMin`. The test BNB it receives stays here; the owner can withdraw it.
/// @dev Never deploy to BSC mainnet: there the app swaps through the real PancakeSwap V2 router.
contract AtlasSwapGuard {
    IAtlasFeed public immutable feed;
    IFaucetToken public immutable token;
    /// @notice Oldest Atlas answer accepted, in seconds (2x the feed's heartbeat).
    uint256 public immutable maxAge;
    address public immutable owner;
    uint256 private immutable scaleUp; // 10 ** token decimals
    uint256 private immutable scaleDown; // 10 ** (18 + feed decimals): wei x price -> token units

    error StalePrice(uint256 updatedAt);
    error BadPrice();
    error BadPath();
    error Expired();
    error InsufficientOutput(uint256 amountOut, uint256 amountOutMin);
    error NotOwner();

    event Swapped(address indexed to, uint256 bnbIn, uint256 tokenOut);

    constructor(IAtlasFeed feed_, IFaucetToken token_, uint256 maxAge_) {
        feed = feed_;
        token = token_;
        maxAge = maxAge_;
        owner = msg.sender;
        scaleUp = 10 ** token_.decimals();
        scaleDown = 10 ** (18 + uint256(feed_.decimals()));
    }

    /// @notice PancakeSwap V2 shape: `[amountIn, amountOut]` for `path = [WBNB, token]` at the Atlas price.
    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        if (path.length != 2 || path[1] != address(token)) revert BadPath();
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * _price() * scaleUp / scaleDown;
    }

    /// @notice PancakeSwap V2 shape: sells `msg.value` BNB and mints the mUSDT to `to`; reverts below `amountOutMin`.
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts)
    {
        if (block.timestamp > deadline) revert Expired();
        amounts = getAmountsOut(msg.value, path);
        if (amounts[1] < amountOutMin) revert InsufficientOutput(amounts[1], amountOutMin);
        emit Swapped(to, msg.value, amounts[1]);
        token.faucet(to, amounts[1]); // MockUSDT caps one mint at its FAUCET_LIMIT
    }

    /// @notice Sends the test BNB collected so far to `to`.
    function withdraw(address payable to) external {
        if (msg.sender != owner) revert NotOwner();
        require(to != address(0));
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok);
    }

    /// @dev Atlas staleness check, as in Atlas's example code: never-updated, non-positive and stale answers revert.
    function _price() internal view returns (uint256) {
        // forge-lint: disable-next-line(unused-return) -- only the answer and its time matter here
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert BadPrice();
        if (block.timestamp > updatedAt + maxAge) revert StalePrice(updatedAt);
        // forge-lint: disable-next-line(unsafe-typecast) -- answer > 0 checked above
        return uint256(answer);
    }
}
