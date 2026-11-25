// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFactory} from "../src/EscrowFactory.sol";
import {FleetVault} from "../src/FleetVault.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {ScriptBase} from "./utils/ScriptBase.sol";

/// @title Seed
/// @notice LOCAL ANVIL ONLY. Creates demo accounts' balances, one funded demo scooter rental so the frontend has
/// something to show, and a second rental already in dispute for the arbiter scene of docs/DEMO.md. Reads `deployments/31337.json` (from {Deploy}) and writes `deployments/31337.demo.json`.
///
///   forge script script/Seed.s.sol --rpc-url "$RPC_URL" --broadcast
///
/// Roles use anvil's default dev accounts: landlord (the scooter rental shop owner) = #1, tenant (the renter) = #2,
/// arbiter = #3 (the KeyEscrow dispute desk, picked up as the factory's default arbiter because the rental passes
/// address(0)). Treasury = #0 (deployer). The contracts keep the landlord/tenant/lease names.
///
/// Numbers: a Honda Click 125i rented monthly from a shop in Chiang Mai at 3,400 THB/month. Assuming ~34 THB per
/// USDT that is 100 mUSDT/month, with a 2-month deposit (200 mUSDT, about 6,800 THB) held in escrow instead of the
/// renter's passport, over a 3-month rental. Windows use the factory defaults (7 days owner response, 14 days
/// arbiter). The disputed rental uses a 60-day arbiter window so it survives the demo's +30 day time jump before the
/// dispute desk rules.
///
/// Evidence: content hashes are SHA-256 of the placeholder files in `web/public/demo/` (served by the web app
/// at /demo/...). The lease hash covers `lease.pdf` (the rental agreement); the check-in hash covers
/// `checkin-manifest.json`, which in turn lists the SHA-256 of every pickup photo of the scooter.
contract Seed is ScriptBase {
    uint256 internal constant RENT_THB = 3_400;
    uint32 internal constant TERM_MONTHS = 3;
    uint32 internal constant DISPUTED_ARBITER_WINDOW = 60 days;
    /// @dev Anvil default account #4 (public dev key, not a secret): the demo shareholder.
    uint256 internal constant ANVIL_KEY_4 =
        0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;

    // Token amounts, set in {run} from the token's own decimals().
    uint256 internal rent; // 3,400 THB / ~34 THB per USDT = 100 tokens
    uint256 internal deposit;
    uint256 internal tenantMint;
    uint256 internal landlordMint;
    uint256 internal arbiterMint;
    uint256 internal disputedClaim; // owner claims 50 tokens (~1,700 THB) for a scratched side panel
    uint256 internal investorDeposit;

    string internal constant DEMO_DIR = "../web/public/demo/";

    error NotLocalAnvil(uint256 chainId);

    function run() external returns (address escrow, address disputed) {
        if (block.chainid != ANVIL_CHAIN_ID) revert NotLocalAnvil(block.chainid);

        string memory deployment = vm.readFile(_deploymentPath());
        MockUSDT usdt = MockUSDT(vm.parseJsonAddress(deployment, ".token"));
        EscrowFactory factory = EscrowFactory(vm.parseJsonAddress(deployment, ".escrowFactory"));
        uint256 unit = 10 ** usdt.decimals();
        rent = 100 * unit;
        deposit = 2 * rent;
        tenantMint = 10_000 * unit;
        landlordMint = 1_000 * unit;
        arbiterMint = 100 * unit;
        disputedClaim = 50 * unit;
        investorDeposit = 3_000 * unit;

        address landlord = vm.addr(ANVIL_KEY_1);
        address tenant = vm.addr(ANVIL_KEY_2);
        address arbiter = factory.defaultArbiter(); // anvil account 3 when deployed by {Deploy}

        bytes32 leaseHash = sha256(vm.readFileBinary(string.concat(DEMO_DIR, "lease.pdf")));
        bytes32 checkInHash = sha256(vm.readFileBinary(string.concat(DEMO_DIR, "checkin-manifest.json")));

        // Faucet is permissionless; the deployer (account 0) tops everyone up.
        vm.startBroadcast(ANVIL_KEY_0);
        usdt.faucet(tenant, tenantMint);
        usdt.faucet(landlord, landlordMint);
        usdt.faucet(arbiter, arbiterMint);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_1);
        escrow = factory.createLease(
            EscrowFactory.LeaseParams({
                tenant: tenant,
                arbiter: address(0), // KeyEscrow dispute desk (factory default)
                rentAmount: rent,
                depositAmount: deposit,
                termMonths: TERM_MONTHS,
                responseWindow: 0, // factory default: 7 days
                arbiterWindow: 0, // factory default: 14 days
                leaseHash: leaseHash
            })
        );
        RentalEscrow(escrow).addEvidence(RentalEscrow.EvidenceKind.CheckIn, checkInHash);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_2);
        usdt.approve(escrow, deposit + rent);
        RentalEscrow(escrow).fund();
        vm.stopBroadcast();

        disputed = _seedDisputedLease(factory, usdt, leaseHash, checkInHash);
        address fleetLease = _seedFleetVault(deployment, factory, usdt, leaseHash, checkInHash);
        _write(escrow, disputed, landlord, tenant, arbiter, leaseHash, checkInHash);
        if (fleetLease != address(0)) {
            vm.writeJson(vm.toString(fleetLease), _demoPath(), ".fleetLease");
            vm.writeJson(vm.toString(vm.addr(ANVIL_KEY_4)), _demoPath(), ".investor");
        }
    }

    /// @dev Second demo rental: funded, owner (landlord) proposes keeping disputedClaim, renter (tenant) disputes.
    function _seedDisputedLease(EscrowFactory factory, MockUSDT usdt, bytes32 leaseHash, bytes32 checkInHash)
        internal
        returns (address disputed)
    {
        vm.startBroadcast(ANVIL_KEY_1);
        disputed = factory.createLease(
            EscrowFactory.LeaseParams({
                tenant: vm.addr(ANVIL_KEY_2),
                arbiter: address(0),
                rentAmount: rent,
                depositAmount: deposit,
                termMonths: TERM_MONTHS,
                responseWindow: 0,
                arbiterWindow: DISPUTED_ARBITER_WINDOW,
                leaseHash: leaseHash
            })
        );
        RentalEscrow(disputed).addEvidence(RentalEscrow.EvidenceKind.CheckIn, checkInHash);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_2);
        usdt.approve(disputed, deposit + rent);
        RentalEscrow(disputed).fund();
        vm.stopBroadcast();

        vm.broadcast(ANVIL_KEY_1);
        RentalEscrow(disputed).propose(deposit - disputedClaim, keccak256("keyescrow.demo.landlord-proposal"));
        vm.broadcast(ANVIL_KEY_2);
        RentalEscrow(disputed).dispute();
    }

    /// @dev Fleet Vault scene: the demo shareholder (#4) buys BKK-FLEET-1 shares, and a third rental pays its owner's
    /// cut into the vault (month 1 rent already released), so the investor dashboard starts with income.
    /// Skipped when the deployment has no vault (older deployments files).
    function _seedFleetVault(
        string memory deployment,
        EscrowFactory factory,
        MockUSDT usdt,
        bytes32 leaseHash,
        bytes32 checkInHash
    ) internal returns (address fleetLease) {
        if (!vm.keyExistsJson(deployment, ".fleetVault")) return address(0);
        FleetVault vault = FleetVault(vm.parseJsonAddress(deployment, ".fleetVault"));
        address investor = vm.addr(ANVIL_KEY_4);

        vm.broadcast(ANVIL_KEY_0);
        usdt.faucet(investor, tenantMint);
        vm.startBroadcast(ANVIL_KEY_4);
        usdt.approve(address(vault), investorDeposit);
        vault.deposit(investorDeposit);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_1);
        fleetLease = factory.createLeaseWithPayee(
            EscrowFactory.LeaseParams({
                tenant: vm.addr(ANVIL_KEY_2),
                arbiter: address(0),
                rentAmount: rent,
                depositAmount: deposit,
                termMonths: TERM_MONTHS,
                responseWindow: 0,
                arbiterWindow: 0,
                leaseHash: leaseHash
            }),
            address(vault)
        );
        RentalEscrow(fleetLease).addEvidence(RentalEscrow.EvidenceKind.CheckIn, checkInHash);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL_KEY_2);
        usdt.approve(fleetLease, deposit + rent);
        RentalEscrow(fleetLease).fund();
        RentalEscrow(fleetLease).releaseRent();
        vm.stopBroadcast();
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
        vm.serializeUint(k, "rentAmount", rent);
        vm.serializeUint(k, "depositAmount", deposit);
        vm.serializeUint(k, "termMonths", TERM_MONTHS);
        vm.serializeBytes32(k, "leaseHash", leaseHash);
        vm.serializeString(k, "leaseFile", "/demo/lease.pdf");
        vm.serializeBytes32(k, "checkInHash", checkInHash);
        string memory json = vm.serializeString(k, "checkInManifest", "/demo/checkin-manifest.json");
        vm.writeJson(json, _demoPath());
    }
}
