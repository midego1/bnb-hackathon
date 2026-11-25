// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @notice Shared helpers for KeyEscrow forge scripts: network guard, anvil dev accounts, deployment file paths.
abstract contract ScriptBase is Script {
    uint256 internal constant ANVIL_CHAIN_ID = 31337;

    // Anvil's well-known default dev keys ("test test ... junk" mnemonic, accounts 0-3). They are public and
    // only ever used against a local anvil node (chain id 31337). Never use them anywhere else.
    uint256 internal constant ANVIL_KEY_0 =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ANVIL_KEY_1 =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant ANVIL_KEY_2 =
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal constant ANVIL_KEY_3 =
        0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;

    error RefusingNonLocalChain(uint256 chainId);
    error RefusingMainnet(uint256 chainId);
    error MissingPrivateKey();

    /// @dev Local anvil always passes. Any other chain needs ALLOW_NON_LOCAL_BROADCAST=true; known mainnets are
    /// refused unconditionally (MockUSDT and the demo setup are testnet-only).
    function _requireAllowedChain() internal view {
        uint256 id = block.chainid;
        if (id == ANVIL_CHAIN_ID) return;
        // Ethereum, BNB Smart Chain, opBNB mainnets.
        if (id == 1 || id == 56 || id == 204) revert RefusingMainnet(id);
        if (!vm.envOr("ALLOW_NON_LOCAL_BROADCAST", false)) revert RefusingNonLocalChain(id);
    }

    /// @dev PRIVATE_KEY from env; falls back to anvil account 0 only on a local anvil chain.
    function _deployerKey() internal view returns (uint256) {
        if (block.chainid == ANVIL_CHAIN_ID) return vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) revert MissingPrivateKey();
        return key;
    }

    /// @dev Directory for deployment JSON files, relative to contracts/ (override with DEPLOYMENTS_DIR).
    function _deploymentsDir() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENTS_DIR", string("deployments"));
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/", vm.toString(block.chainid), ".json");
    }

    function _demoPath() internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/", vm.toString(block.chainid), ".demo.json");
    }
}
