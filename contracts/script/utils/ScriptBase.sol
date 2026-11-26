// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

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
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    uint256 internal constant BSC_TESTNET_CHAIN_ID = 97;
    uint256 internal constant OPBNB_TESTNET_CHAIN_ID = 5611;
    uint256 internal constant BSC_MAINNET_CHAIN_ID = 56;
    /// @dev BSC-USD (Tether USD on BNB Smart Chain, 18 decimals): the only token a mainnet deployment may use.
    address internal constant BSC_USD = 0x55d398326f99059fF775485246999027B3197955;

    error RefusingNonLocalChain(uint256 chainId);
    error RefusingMainnet(uint256 chainId);
    error RefusingUnknownChain(uint256 chainId);
    error MissingPrivateKey();
    error MissingDeployer();
    error DeployerMismatch(address expected, address actual);
    error MissingRoleAddress(string envName);
    error RefusingAnvilAccount(string role, address account);
    error MainnetNotConfirmed();

    /// @dev Local anvil always passes. BSC testnet (97) and opBNB testnet (5611) need ALLOW_NON_LOCAL_BROADCAST=true.
    /// BSC mainnet (56, the capped pilot) needs that AND MAINNET_I_UNDERSTAND=yes. Ethereum and opBNB mainnets are
    /// refused unconditionally, and so is any other chain id.
    function _requireAllowedChain() internal view {
        uint256 id = block.chainid;
        if (id == ANVIL_CHAIN_ID) return;
        if (id == 1 || id == 204) revert RefusingMainnet(id);
        if (id != BSC_TESTNET_CHAIN_ID && id != OPBNB_TESTNET_CHAIN_ID && id != BSC_MAINNET_CHAIN_ID) {
            revert RefusingUnknownChain(id);
        }
        if (!vm.envOr("ALLOW_NON_LOCAL_BROADCAST", false)) revert RefusingNonLocalChain(id);
        if (
            id == BSC_MAINNET_CHAIN_ID
                && keccak256(bytes(vm.envOr("MAINNET_I_UNDERSTAND", string("")))) != keccak256("yes")
        ) {
            revert MainnetNotConfirmed();
        }
    }

    function _isLocal() internal view returns (bool) {
        return block.chainid == ANVIL_CHAIN_ID;
    }

    /// @dev PRIVATE_KEY from env; falls back to anvil account 0 only on a local anvil chain.
    function _deployerKey() internal view returns (uint256) {
        if (_isLocal()) return vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) revert MissingPrivateKey();
        return key;
    }

    /// @dev Deployer for scripts that also accept a forge wallet (`--account <keystore name>` / `--keystore`, plus
    /// `--sender`). Returns `key = 0` when the wallet comes from forge rather than PRIVATE_KEY; broadcast with
    /// `vm.startBroadcast(addr)` in that case. On anvil it still falls back to account 0.
    /// If DEPLOYER_ADDRESS is set, the resolved deployer must match it (catches a wrong key or keystore).
    function _deployer() internal view returns (uint256 key, address addr) {
        key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key != 0) {
            addr = vm.addr(key);
        } else if (_isLocal()) {
            (key, addr) = (ANVIL_KEY_0, vm.addr(ANVIL_KEY_0));
        } else {
            // Without --sender forge runs scripts as DEFAULT_SENDER, which nobody holds a key for.
            if (msg.sender == DEFAULT_SENDER) revert MissingDeployer();
            addr = msg.sender;
        }
        address expected = vm.envOr("DEPLOYER_ADDRESS", address(0));
        if (expected != address(0) && expected != addr) revert DeployerMismatch(expected, addr);
    }

    /// @dev Role address from env. Required (no default) off anvil, where it must not be an anvil dev account.
    function _roleAddress(string memory envName, address localDefault) internal view returns (address a) {
        if (_isLocal()) return vm.envOr(envName, localDefault);
        a = vm.envOr(envName, address(0));
        if (a == address(0)) revert MissingRoleAddress(envName);
        _refuseAnvilAccount(envName, a);
    }

    /// @dev Off anvil, refuse anvil's public default accounts (0-9): anyone can sign for them.
    function _refuseAnvilAccount(string memory role, address a) internal view {
        if (_isLocal()) return;
        for (uint32 i = 0; i < 10; i++) {
            if (vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i)) == a) revert RefusingAnvilAccount(role, a);
        }
    }

    /// @dev Directory for deployment JSON files, relative to contracts/ (override with DEPLOYMENTS_DIR).
    function _deploymentsDir() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENTS_DIR", string("deployments"));
    }

    /// @dev `<chainId>.json`, or `<chainId>.dry-run.json` (gitignored) when forge only simulates, so a preflight
    /// never leaves a deployments file with addresses that do not exist on-chain.
    function _deploymentPath() internal view returns (string memory) {
        string memory suffix = vm.isContext(VmSafe.ForgeContext.ScriptDryRun) ? ".dry-run.json" : ".json";
        return string.concat(_deploymentsDir(), "/", vm.toString(block.chainid), suffix);
    }

    function _demoPath() internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/", vm.toString(block.chainid), ".demo.json");
    }
}
