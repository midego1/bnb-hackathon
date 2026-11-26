// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AtlasSwapGuard, IAtlasFeed, IFaucetToken} from "../src/AtlasSwapGuard.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";

contract AtlasSwapGuardTest is Test {
    MockUSDT internal usdt = new MockUSDT();
    MockAtlasFeed internal feed;
    AtlasSwapGuard internal guard;
    address internal renter = makeAddr("renter");
    address[] internal path;

    function setUp() public {
        vm.warp(1_800_000_000);
        feed = new MockAtlasFeed(650e18);
        guard = new AtlasSwapGuard(IAtlasFeed(address(feed)), IFaucetToken(address(usdt)), 240);
        path = [address(0xbb4C), address(usdt)];
        vm.deal(renter, 10 ether);
    }

    function test_quote_atAtlasPrice() public view {
        // 0.01 BNB x 650 USD = 6.5 mUSDT (6 decimals)
        assertEq(guard.getAmountsOut(0.01 ether, path)[1], 6.5e6);
    }

    function test_swap_mintsAtAtlasPrice() public {
        vm.prank(renter);
        guard.swapExactETHForTokens{value: 0.01 ether}(6.435e6, path, renter, block.timestamp);
        assertEq(usdt.balanceOf(renter), 6.5e6);
        assertEq(address(guard).balance, 0.01 ether);
    }

    function test_swap_revertsBelowMinOut() public {
        feed.set(640e18); // price fell after the app computed amountOutMin
        vm.prank(renter);
        vm.expectRevert(abi.encodeWithSelector(AtlasSwapGuard.InsufficientOutput.selector, 6.4e6, 6.435e6));
        guard.swapExactETHForTokens{value: 0.01 ether}(6.435e6, path, renter, block.timestamp);
    }

    function test_swap_revertsOnStaleFeed() public {
        uint256 updated = feed.updatedAt();
        vm.warp(updated + 241);
        vm.prank(renter);
        vm.expectRevert(abi.encodeWithSelector(AtlasSwapGuard.StalePrice.selector, updated));
        guard.swapExactETHForTokens{value: 0.01 ether}(0, path, renter, block.timestamp);
    }

    function test_swap_revertsOnBadPricePathOrDeadline() public {
        vm.startPrank(renter);
        vm.expectRevert(AtlasSwapGuard.Expired.selector);
        guard.swapExactETHForTokens{value: 0.01 ether}(0, path, renter, block.timestamp - 1);
        address[] memory wrong = new address[](2);
        vm.expectRevert(AtlasSwapGuard.BadPath.selector);
        guard.swapExactETHForTokens{value: 0.01 ether}(0, wrong, renter, block.timestamp);
        vm.stopPrank();
        feed.set(0);
        vm.expectRevert(AtlasSwapGuard.BadPrice.selector);
        guard.getAmountsOut(1 ether, path);
    }

    function test_withdraw_ownerOnly() public {
        vm.prank(renter);
        guard.swapExactETHForTokens{value: 0.01 ether}(0, path, renter, block.timestamp);
        vm.prank(renter);
        vm.expectRevert(AtlasSwapGuard.NotOwner.selector);
        guard.withdraw(payable(renter));
        address payable sink = payable(makeAddr("sink"));
        guard.withdraw(sink);
        assertEq(sink.balance, 0.01 ether);
    }
}
