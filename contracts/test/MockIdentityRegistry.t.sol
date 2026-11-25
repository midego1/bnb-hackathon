// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

/// The ERC-8004 registry stand-in used by the agent's local rehearsal (agent/scripts/rehearse.sh).
contract MockIdentityRegistryTest is Test {
    MockIdentityRegistry reg;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue
    );

    function setUp() public {
        reg = new MockIdentityRegistry();
    }

    function _entries(string memory k, bytes memory v)
        internal
        pure
        returns (MockIdentityRegistry.MetadataEntry[] memory e)
    {
        e = new MockIdentityRegistry.MetadataEntry[](1);
        e[0] = MockIdentityRegistry.MetadataEntry(k, v);
    }

    function test_register_assignsSequentialIdsFromZero() public {
        vm.expectEmit(true, true, false, true);
        emit Registered(0, "data:a", alice);
        vm.prank(alice);
        assertEq(reg.register("data:a"), 0);
        vm.prank(bob);
        assertEq(reg.register(), 1);
        assertEq(reg.ownerOf(0), alice);
        assertEq(reg.getAgentWallet(0), alice);
        assertEq(reg.balanceOf(alice), 1);
        assertEq(reg.tokenURI(0), "data:a");
        assertEq(reg.tokenURI(1), "");
    }

    function test_register_withMetadata() public {
        vm.expectEmit(true, true, false, true);
        emit MetadataSet(0, "reportSigner", "reportSigner", abi.encodePacked(bob));
        vm.prank(alice);
        reg.register("data:a", _entries("reportSigner", abi.encodePacked(bob)));
        assertEq(reg.getMetadata(0, "reportSigner"), abi.encodePacked(bob));
        assertEq(reg.getMetadata(0, "missing"), "");
    }

    function test_register_rejectsReservedAgentWalletKey() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MockIdentityRegistry.ReservedMetadataKey.selector, "agentWallet")
        );
        reg.register("data:a", _entries("agentWallet", abi.encodePacked(bob)));
    }

    function test_setAgentURI_andMetadata_onlyOwner() public {
        vm.prank(alice);
        reg.register("data:a");
        vm.prank(alice);
        reg.setAgentURI(0, "data:b");
        assertEq(reg.tokenURI(0), "data:b");
        vm.prank(alice);
        reg.setMetadata(0, "k", "v");
        assertEq(reg.getMetadata(0, "k"), "v");

        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockIdentityRegistry.NotAgentOwner.selector, 0, bob));
        reg.setAgentURI(0, "data:evil");
        vm.expectRevert(abi.encodeWithSelector(MockIdentityRegistry.NotAgentOwner.selector, 0, bob));
        reg.setMetadata(0, "k", "evil");
        vm.stopPrank();
    }

    function test_unknownAgent_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(MockIdentityRegistry.ERC721NonexistentToken.selector, 5));
        reg.ownerOf(5);
        vm.expectRevert(abi.encodeWithSelector(MockIdentityRegistry.ERC721NonexistentToken.selector, 5));
        reg.tokenURI(5);
        vm.expectRevert(abi.encodeWithSelector(MockIdentityRegistry.ERC721NonexistentToken.selector, 5));
        reg.getAgentWallet(5);
    }

    function test_worksWithoutConstructor_viaEtch() public {
        address canonical = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
        vm.etch(canonical, address(reg).code);
        MockIdentityRegistry etched = MockIdentityRegistry(canonical);
        vm.prank(alice);
        assertEq(etched.register("data:x"), 0);
        assertEq(etched.name(), "AgentIdentity");
        assertEq(etched.ownerOf(0), alice);
    }
}
