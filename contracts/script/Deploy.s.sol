// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {FleetVault} from "../src/FleetVault.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {ScriptBase} from "./utils/ScriptBase.sol";

/// @title Deploy
/// @notice Deploys MockUSDT + EscrowFactory and writes the addresses to `deployments/<chainId>.json`.
///
/// Local anvil roles: deployer / factory owner / KeyEscrow treasury (fee recipient) = account 0,
/// KeyEscrow dispute desk (default arbiter) = account 3.
///
///   forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast
///
/// BSC testnet (97): use `pnpm deploy:testnet:check` / `pnpm deploy:testnet` (contracts/script/testnet.sh), see
/// docs/DEPLOY.md. Without --broadcast forge only simulates and the output goes to `<chainId>.dry-run.json`.
///
/// Env (all optional on anvil; on any other chain the four role/opt-in variables are REQUIRED):
///   ALLOW_NON_LOCAL_BROADCAST   must be `true` to run against 97 / 5611; mainnets and other chains always refused
///   PRIVATE_KEY                 deployer key; defaults to anvil account 0 on chain 31337 only. Off anvil prefer a
///                               forge keystore instead: `--account <name> --sender <address>` (PRIVATE_KEY unset)
///   FACTORY_OWNER               factory owner (default: the deployer, on anvil only)
///   FEE_RECIPIENT               KeyEscrow treasury (default: the deployer, i.e. anvil account 0, on anvil only)
///   DEFAULT_ARBITER             KeyEscrow dispute desk (default: anvil account 3, on anvil only)
///   TOKEN_ADDRESS               reuse an existing stablecoin instead of deploying MockUSDT
///   FEE_BPS                     one-time fee in bps of one month's rent (default 1000 = 10%, max 1000)
///   DEPLOYMENTS_DIR             output directory relative to contracts/ (default `deployments`)
///   FLEET_OPERATOR              Fleet Vault operator, gets the maintenance fee (default: anvil account 1, the demo
///                               fleet owner, on anvil; FEE_RECIPIENT elsewhere)
///   FLEET_OPERATOR_FEE_BPS      operator fee in bps of vault income (default 1000 = 10%, max 3000)
///   FLEET_NAME / FLEET_SYMBOL   share token metadata (default "KeyEscrow Bangkok Fleet 1" / "BKK-FLEET-1")
/// Off anvil the deployer and every role address must not be one of anvil's public default accounts.
contract Deploy is ScriptBase {
    error FeeBpsOutOfRange(uint256 feeBps);

    struct Deployment {
        address token;
        address factory;
        address implementation;
        address deployer;
        address owner;
        address feeRecipient;
        address defaultArbiter;
        uint16 feeBps;
        uint256 startBlock;
        address fleetVault;
        address fleetOperator;
        uint16 fleetOperatorFeeBps;
        uint8 tokenDecimals; // read from the token: 6 for MockUSDT, 18 for BSC-USD
        string tokenSymbol;
    }

    function run() external returns (Deployment memory d) {
        _requireAllowedChain();
        uint256 key;
        (key, d.deployer) = _deployer();
        _refuseAnvilAccount("deployer", d.deployer);

        d.owner = _roleAddress("FACTORY_OWNER", d.deployer);
        d.feeRecipient = _roleAddress("FEE_RECIPIENT", d.deployer);
        d.defaultArbiter = _roleAddress("DEFAULT_ARBITER", vm.addr(ANVIL_KEY_3));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(1_000));
        if (feeBps > type(uint16).max) revert FeeBpsOutOfRange(feeBps);
        // forge-lint: disable-next-line(unsafe-typecast) -- range-checked above; the factory caps it further
        d.feeBps = uint16(feeBps);
        d.token = vm.envOr("TOKEN_ADDRESS", address(0));
        d.fleetOperator = _isLocal()
            ? vm.envOr("FLEET_OPERATOR", vm.addr(ANVIL_KEY_1))
            : vm.envOr("FLEET_OPERATOR", d.feeRecipient);
        if (!_isLocal()) _refuseAnvilAccount("FLEET_OPERATOR", d.fleetOperator);
        uint256 opFee = vm.envOr("FLEET_OPERATOR_FEE_BPS", uint256(1_000));
        if (opFee > 3_000) revert FeeBpsOutOfRange(opFee);
        // forge-lint: disable-next-line(unsafe-typecast) -- range-checked above
        d.fleetOperatorFeeBps = uint16(opFee);
        d.startBlock = block.number;

        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast(d.deployer);
        if (d.token == address(0)) d.token = address(new MockUSDT());
        EscrowFactory factory =
            new EscrowFactory(IERC20(d.token), d.owner, d.feeBps, d.feeRecipient, d.defaultArbiter);
        // Deployed last so the token and factory keep their addresses (deployer nonces 0 and 1 on a fresh anvil).
        d.fleetVault = address(
            new FleetVault(
                IERC20(d.token),
                vm.envOr("FLEET_NAME", string("KeyEscrow Bangkok Fleet 1")),
                vm.envOr("FLEET_SYMBOL", string("BKK-FLEET-1")),
                d.fleetOperator,
                d.fleetOperatorFeeBps
            )
        );
        vm.stopBroadcast();

        d.factory = address(factory);
        d.implementation = factory.implementation();
        d.tokenDecimals = IERC20Metadata(d.token).decimals();
        d.tokenSymbol = IERC20Metadata(d.token).symbol();
        _write(d);
    }

    function _write(Deployment memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "token", d.token);
        vm.serializeString(k, "tokenSymbol", d.tokenSymbol);
        vm.serializeUint(k, "tokenDecimals", d.tokenDecimals);
        vm.serializeAddress(k, "escrowFactory", d.factory);
        vm.serializeAddress(k, "rentalEscrowImplementation", d.implementation);
        vm.serializeAddress(k, "deployer", d.deployer);
        vm.serializeAddress(k, "factoryOwner", d.owner);
        vm.serializeAddress(k, "feeRecipient", d.feeRecipient);
        vm.serializeUint(k, "feeBps", d.feeBps);
        vm.serializeAddress(k, "defaultArbiter", d.defaultArbiter);
        vm.serializeAddress(k, "fleetVault", d.fleetVault);
        vm.serializeAddress(k, "fleetOperator", d.fleetOperator);
        vm.serializeUint(k, "fleetOperatorFeeBps", d.fleetOperatorFeeBps);
        string memory json = vm.serializeUint(k, "startBlock", d.startBlock);

        string memory path = _deploymentPath();
        vm.createDir(_deploymentsDir(), true);
        vm.writeJson(json, path);
    }
}
