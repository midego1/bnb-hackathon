// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFactory} from "../src/EscrowFactory.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {ScriptBase} from "./utils/ScriptBase.sol";

/// @title Seed
/// @notice LOCAL ANVIL ONLY. Creates demo accounts' balances, one funded demo lease so the frontend has
/// something to show, and a second lease already in dispute for the arbiter scene of docs/DEMO.md. Reads `deployments/31337.json` (from {Deploy}) and writes `deployments/31337.demo.json`.
///
///   forge script script/Seed.s.sol --rpc-url "$RPC_URL" --broadcast
///
/// Roles use anvil's default dev accounts: landlord = #1, tenant = #2, arbiter = #3 (the KeyEscrow dispute desk,
/// picked up as the factory's default arbiter because the lease passes address(0)). Treasury = #0 (deployer).
///
/// Numbers: a Bangkok condo at 15,000 THB/month. Assuming ~34 THB per USDT that is 441.18 mUSDT/month,
/// with the customary 2-month deposit (882.36 mUSDT) on a 12-month lease. Windows use the factory
/// defaults (7 days landlord response, 14 days arbiter). The disputed lease uses a 60-day arbiter window so it
/// survives the demo's +30 day time jump before the dispute desk rules.
///
/// Evidence: content hashes are SHA-256 of the placeholder files in `web/public/demo/` (served by the web app
/// at /demo/...). The lease hash covers `lease.pdf`; the check-in hash covers `checkin-manifest.json`, which in
/// turn lists the SHA-256 of every check-in photo.
contract Seed is ScriptBase {
    uint256 internal constant RENT_THB = 15_000;
    /// @dev 15,000 THB / ~34 THB per USDT, rounded to cents (6-decimal token units).
    uint256 internal constant RENT = 441_180_000;
    uint256 internal constant DEPOSIT = 2 * RENT;
    uint32 internal constant TERM_MONTHS = 12;

    uint256 internal constant TENANT_MINT = 10_000e6;
    uint256 internal constant LANDLORD_MINT = 1_000e6;
    uint256 internal constant ARBITER_MINT = 100e6;
    uint256 internal constant DISPUTED_CLAIM = 100e6; // landlord claims 100 mUSDT for a wall repaint
    uint32 internal constant DISPUTED_ARBITER_WINDOW = 60 days;

    string internal constant DEMO_DIR = "../web/public/demo/";

    error NotLocalAnvil(uint256 chainId);

    function run() external returns (address escrow, address disputed) {
        if (block.chainid != ANVIL_CHAIN_ID) revert NotLocalAnvil(block.chainid);

        string memory deployment = vm.readFile(_deploymentPath());
        MockUSDT usdt = MockUSDT(vm.parseJsonAddress(deployment, ".token"));
        EscrowFactory factory = EscrowFactory(vm.parseJsonAddress(deployment, ".escrowFactory"));

        address landlord = vm.addr(ANVIL_KEY_1);
        address tenant = vm.addr(ANVIL_KEY_2);
        address arbiter = factory.defaultArbiter(); // anvil account 3 when deployed by {Deploy}

        bytes32 leaseHash = sha256(vm.readFileBinary(string.concat(DEMO_DIR, "lease.pdf")));
        bytes32 checkInHash = sha256(vm.readFileBinary(string.concat(DEMO_DIR, "checkin-manifest.json")));

        // Faucet is permissionless; the deployer (account 0) tops everyone up.
        vm.startBroadcast(ANVIL_KEY_0);
        usdt.faucet(tenant, TENANT_MINT);
        usdt.faucet(landlord, LANDLORD_MINT);
        usdt.faucet(arbiter, ARBITER_MINT);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_1);
        escrow = factory.createLease(
            EscrowFactory.LeaseParams({
                tenant: tenant,
                arbiter: address(0), // KeyEscrow dispute desk (factory default)
                rentAmount: RENT,
                depositAmount: DEPOSIT,
                termMonths: TERM_MONTHS,
                responseWindow: 0, // factory default: 7 days
                arbiterWindow: 0, // factory default: 14 days
                leaseHash: leaseHash
            })
        );
        RentalEscrow(escrow).addEvidence(RentalEscrow.EvidenceKind.CheckIn, checkInHash);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_2);
        usdt.approve(escrow, DEPOSIT + RENT);
        RentalEscrow(escrow).fund();
        vm.stopBroadcast();

        disputed = _seedDisputedLease(factory, usdt, leaseHash, checkInHash);
        _write(escrow, disputed, landlord, tenant, arbiter, leaseHash, checkInHash);
    }

    /// @dev Second demo lease: funded, landlord proposes keeping DISPUTED_CLAIM, tenant disputes.
    function _seedDisputedLease(EscrowFactory factory, MockUSDT usdt, bytes32 leaseHash, bytes32 checkInHash)
        internal
        returns (address disputed)
    {
        vm.startBroadcast(ANVIL_KEY_1);
        disputed = factory.createLease(
            EscrowFactory.LeaseParams({
                tenant: vm.addr(ANVIL_KEY_2),
                arbiter: address(0),
                rentAmount: RENT,
                depositAmount: DEPOSIT,
                termMonths: TERM_MONTHS,
                responseWindow: 0,
                arbiterWindow: DISPUTED_ARBITER_WINDOW,
                leaseHash: leaseHash
            })
        );
        RentalEscrow(disputed).addEvidence(RentalEscrow.EvidenceKind.CheckIn, checkInHash);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_2);
        usdt.approve(disputed, DEPOSIT + RENT);
        RentalEscrow(disputed).fund();
        vm.stopBroadcast();

        vm.broadcast(ANVIL_KEY_1);
        RentalEscrow(disputed)
            .propose(DEPOSIT - DISPUTED_CLAIM, keccak256("keyescrow.demo.landlord-proposal"));
        vm.broadcast(ANVIL_KEY_2);
        RentalEscrow(disputed).dispute();
    }

    function _write(
        address escrow,
        address disputed,
        address landlord,
        address tenant,
        address arbiter,
        bytes32 leaseHash,
        bytes32 checkInHash
    ) internal {
        string memory k = "demo";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "lease", escrow);
        vm.serializeAddress(k, "disputedLease", disputed);
        vm.serializeAddress(k, "landlord", landlord);
        vm.serializeAddress(k, "tenant", tenant);
        vm.serializeAddress(k, "arbiter", arbiter);
        vm.serializeUint(k, "rentThb", RENT_THB);
        vm.serializeUint(k, "rentAmount", RENT);
        vm.serializeUint(k, "depositAmount", DEPOSIT);
        vm.serializeUint(k, "termMonths", TERM_MONTHS);
        vm.serializeBytes32(k, "leaseHash", leaseHash);
        vm.serializeString(k, "leaseFile", "/demo/lease.pdf");
        vm.serializeBytes32(k, "checkInHash", checkInHash);
        string memory json = vm.serializeString(k, "checkInManifest", "/demo/checkin-manifest.json");
        vm.writeJson(json, _demoPath());
    }
}
