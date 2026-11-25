// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";

contract MockUSDTTest is Test {
    MockUSDT internal usdt = new MockUSDT();

    function test_metadata() public view {
        assertEq(usdt.decimals(), 6);
        assertEq(usdt.symbol(), "mUSDT");
    }

    function test_faucet_mintsUpToLimit() public {
        usdt.faucet(address(this), usdt.FAUCET_LIMIT());
        assertEq(usdt.balanceOf(address(this)), 10_000e6);
    }

    function test_faucet_revertsAboveLimit() public {
        uint256 limit = usdt.FAUCET_LIMIT();
        vm.expectRevert(abi.encodeWithSelector(MockUSDT.FaucetLimitExceeded.selector, limit + 1, limit));
        usdt.faucet(address(this), limit + 1);
    }
}
