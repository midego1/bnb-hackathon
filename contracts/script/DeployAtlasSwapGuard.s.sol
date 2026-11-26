// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AtlasSwapGuard, IAtlasFeed, IFaucetToken} from "../src/AtlasSwapGuard.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ScriptBase} from "./utils/ScriptBase.sol";

/// @title DeployAtlasSwapGuard
/// @notice Deploys the testnet "Pay with BNB" demo swap (AtlasSwapGuard) next to an existing KeyScrow deployment and
/// adds `atlasSwapGuard` (and on anvil `atlasFeedBnbUsd`) to `deployments/<chainId>.json`. Run Deploy.s.sol first.
///
///   anvil:        forge script script/DeployAtlasSwapGuard.s.sol --rpc-url "$RPC_URL" --broadcast
///   BSC testnet:  ALLOW_NON_LOCAL_BROADCAST=true forge script script/DeployAtlasSwapGuard.s.sol --rpc-url "$RPC_URL" \
///                   --account <keystore> --sender <address> --broadcast   (then `pnpm -C web sync:contracts`)
///
/// Anvil: a MockAtlasFeed at 650 USD/BNB, both sent from anvil dev account 9 (nonces 0 and 1), so the addresses are
/// the same on every fresh anvil whatever else ran before. BSC testnet: the Atlas BNB/USD push feed
/// (ATLAS_FEED_BNB_USD, default below). Refused on BSC mainnet, which uses the real PancakeSwap router.
/// Env: ATLAS_GUARD_MAX_AGE seconds (default 120: twice the feed's 60 s heartbeat), DEPLOYMENTS_DIR.
contract DeployAtlasSwapGuard is ScriptBase {
    address internal constant ATLAS_BNB_USD_TESTNET = 0x3957d289ee9C38272377786787ea34F9dd29788D;

    error OnlyLocalOrBscTestnet(uint256 chainId);

    function run() external returns (AtlasSwapGuard guard) {
        _requireAllowedChain();
        if (!_isLocal() && block.chainid != BSC_TESTNET_CHAIN_ID) revert OnlyLocalOrBscTestnet(block.chainid);
        string memory path = string.concat(_deploymentsDir(), "/", vm.toString(block.chainid), ".json");
        IFaucetToken token = IFaucetToken(vm.parseJsonAddress(vm.readFile(path), ".token"));
        uint256 maxAge = vm.envOr("ATLAS_GUARD_MAX_AGE", uint256(120));

        IAtlasFeed feed;
        if (_isLocal()) {
            vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 9));
            feed = IAtlasFeed(address(new MockAtlasFeed(650e18)));
        } else {
            (uint256 key, address deployer) = _deployer();
            _refuseAnvilAccount("deployer", deployer);
            if (key != 0) vm.startBroadcast(key);
            else vm.startBroadcast(deployer);
            feed = IAtlasFeed(vm.envOr("ATLAS_FEED_BNB_USD", ATLAS_BNB_USD_TESTNET));
        }
        guard = new AtlasSwapGuard(feed, token, maxAge);
        vm.stopBroadcast();

        if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) return guard;
        vm.writeJson(vm.toString(address(guard)), path, ".atlasSwapGuard");
        if (_isLocal()) vm.writeJson(vm.toString(address(feed)), path, ".atlasFeedBnbUsd");
    }
}
