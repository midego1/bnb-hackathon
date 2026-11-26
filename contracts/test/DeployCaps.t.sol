// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract DeployCapsHarness is Deploy {
    function parse(string memory s, uint8 decimals) external pure returns (uint256) {
        return _parseUnits("X", s, decimals);
    }

    function cap(string memory envName, string memory mainnetDefault, uint8 decimals)
        external
        view
        returns (uint256)
    {
        return _cap(envName, mainnetDefault, decimals);
    }
}

/// @notice The mainnet pilot caps are read from env in tokens with decimals ("0.70"), exactly (Deploy.s.sol `_cap`).
contract DeployCapsTest is Test {
    DeployCapsHarness h = new DeployCapsHarness();

    function test_parseUnits_exactDecimals() public view {
        assertEq(h.parse("0.70", 18), 0.7e18);
        assertEq(h.parse("0.30", 18), 0.3e18);
        assertEq(h.parse("5", 18), 5e18);
        assertEq(h.parse("1.000000000000000001", 18), 1e18 + 1);
        assertEq(h.parse("12.5", 6), 12_500_000);
        assertEq(h.parse("0", 18), 0);
        assertEq(h.parse(".5", 6), 500_000);
    }

    function test_parseUnits_refusesJunk() public {
        string[7] memory bad = ["", ".", "1.2.3", "-1", "1e18", "0,70", "0.0000001"];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(Deploy.BadTokenAmount.selector, "X", bad[i]));
            h.parse(bad[i], 6);
        }
    }

    function test_cap_mainnetDefaultsAndOverride_unlimitedElsewhere() public {
        vm.chainId(56);
        vm.setEnv("MAX_DEPOSIT", "");
        assertEq(h.cap("MAX_DEPOSIT", "0.70", 18), 0.7e18);
        vm.setEnv("MAX_DEPOSIT", "0.5");
        assertEq(h.cap("MAX_DEPOSIT", "0.70", 18), 0.5e18);
        vm.chainId(97);
        vm.setEnv("MAX_DEPOSIT", "");
        assertEq(h.cap("MAX_DEPOSIT", "0.70", 6), type(uint256).max);
        vm.setEnv("MAX_DEPOSIT", "2.25");
        assertEq(h.cap("MAX_DEPOSIT", "0.70", 6), 2_250_000);
        vm.setEnv("MAX_DEPOSIT", "");
    }
}
