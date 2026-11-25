import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import { summarizeRentals, worstFlag, type ChainEvent } from "@/lib/rentals";
import { incomeOf, scooterState, type Scooter } from "@/lib/fleet";

const FACTORY = "0x00000000000000000000000000000000000000f1" as Address;
const LEASE = "0x00000000000000000000000000000000000000a1" as Address;
const VAULT = "0x00000000000000000000000000000000000000b1" as Address;
const OWNER = "0x0000000000000000000000000000000000000001" as Address;
const RENTER = "0x0000000000000000000000000000000000000002" as Address;
const DESK = "0x0000000000000000000000000000000000000003" as Address;
const DAY = BigInt(86_400);
const T0 = BigInt(1_790_000_000);
const RENT = BigInt(100_000_000);
const DEPOSIT = BigInt(200_000_000);

let n = 0;
function ev(address: Address, name: string, args: Record<string, unknown>, timestamp: bigint): ChainEvent {
  n++;
  return { address, name, args, txHash: `0x${n.toString(16).padStart(64, "0")}` as Hex, blockNumber: BigInt(n), logIndex: 0, timestamp };
}

const created = (ts = T0) =>
  ev(FACTORY, "LeaseCreated", {
    escrow: LEASE, landlord: OWNER, tenant: RENTER, arbiter: DESK, rentAmount: RENT, depositAmount: DEPOSIT,
    termMonths: 3, responseWindow: 7 * 86_400, arbiterWindow: 14 * 86_400, leaseHash: "0x" + "11".repeat(32),
  }, ts);

describe("summarizeRentals", () => {
  it("follows a damaged return into the vault", () => {
    const events = [
      created(),
      ev(FACTORY, "PayeeSet", { escrow: LEASE, payee: VAULT }, T0),
      ev(LEASE, "EvidenceAdded", { kind: 0, contentHash: "0x" + "aa".repeat(32), by: OWNER }, T0),
      ev(LEASE, "Funded", { tenant: RENTER, deposit: DEPOSIT, firstRent: RENT, startTime: T0 + BigInt(10) }, T0 + BigInt(10)),
      ev(LEASE, "RentReleased", { caller: RENTER, months: 1, toLandlord: BigInt(90_000_000), fee: BigInt(10_000_000) }, T0 + BigInt(20)),
      ev(LEASE, "EvidenceAdded", { kind: 1, contentHash: "0x" + "bb".repeat(32), by: RENTER }, T0 + BigInt(30)),
      ev(LEASE, "SettlementProposed", { proposer: RENTER, nonce: 1, tenantRefund: BigInt(150_000_000), landlordClaim: BigInt(50_000_000), reportHash: "0x" + "cc".repeat(32) }, T0 + BigInt(40)),
      ev(LEASE, "Settled", { tenantRefund: BigInt(150_000_000), landlordClaim: BigInt(50_000_000), rentToLandlord: BigInt(0), rentToTenant: BigInt(0), fee: BigInt(0), basis: "0x" + "cc".repeat(32) }, T0 + BigInt(50)),
    ];
    const [r] = summarizeRentals(events.reverse(), T0 + DAY);
    expect(r.payee).toBe(VAULT);
    expect(r.status).toBe(LeaseStatus.Settled);
    expect(r.pickupPhotos).toHaveLength(1);
    expect(r.returnPhotos).toHaveLength(1);
    expect(r.totals).toMatchObject({ rentToOwner: BigInt(90_000_000), fees: BigInt(10_000_000), slashed: BigInt(50_000_000), refunded: BigInt(150_000_000), depositLocked: BigInt(0) });
    expect(r.flags).toEqual([]);
    expect(incomeOf([r]).total).toBe(BigInt(140_000_000));
  });

  it("stops the rent clock at the move-out, like the contract", () => {
    const [r] = summarizeRentals(
      [
        created(),
        ev(LEASE, "Funded", { deposit: DEPOSIT, firstRent: RENT, startTime: T0 }, T0),
        ev(LEASE, "RentPaid", { months: 1, amount: RENT, monthsFunded: 2 }, T0),
        ev(LEASE, "RentReleased", { caller: RENTER, months: 1, toLandlord: RENT, fee: BigInt(0) }, T0),
        ev(LEASE, "SettlementProposed", { proposer: RENTER, nonce: 1, tenantRefund: DEPOSIT, landlordClaim: BigInt(0), reportHash: "0x" + "cc".repeat(32) }, T0 + BigInt(10) * DAY),
        ev(LEASE, "DisputeRaised", { by: OWNER }, T0 + BigInt(12) * DAY),
      ],
      T0 + BigInt(40) * DAY, // month 2 would be due by now, but the renter returned on day 10
    );
    expect(r.moveOutAt).toBe(T0 + BigInt(10) * DAY);
    expect(r.flags.map((f) => f.code)).not.toContain("rent-due");
  });

  it("flags disputes, overdue arbiters, stale offers, unreleased rent and failed txs", () => {
    const disputed = summarizeRentals(
      [created(), ev(LEASE, "Funded", { deposit: DEPOSIT, firstRent: RENT, startTime: T0 }, T0), ev(LEASE, "DisputeRaised", { by: OWNER }, T0)],
      T0 + DAY,
    )[0];
    expect(disputed.status).toBe(LeaseStatus.Disputed);
    expect(disputed.flags.map((f) => f.code)).toEqual(["disputed", "rent-due"]);
    expect(worstFlag(disputed.flags)).toBe("danger");

    const overdue = summarizeRentals(
      [created(), ev(LEASE, "Funded", { deposit: DEPOSIT, firstRent: RENT, startTime: T0 }, T0), ev(LEASE, "DisputeRaised", { by: OWNER }, T0)],
      T0 + DAY * BigInt(15),
    )[0];
    expect(overdue.flags[0].code).toBe("arbiter-overdue");

    const stale = summarizeRentals([created()], T0 + DAY * BigInt(3))[0];
    expect(stale.flags.map((f) => f.code)).toEqual(["unfunded"]);

    const failed = summarizeRentals([created()], T0, new Map([[LEASE.toLowerCase(), ["0x01" as Hex]]]))[0];
    expect(failed.flags[0]).toMatchObject({ level: "danger", code: "failed-tx" });
  });

  it("derives the scooter state from its latest rental", () => {
    const scooter = { id: "s", rentals: [LEASE] } as unknown as Scooter;
    const map = (events: ChainEvent[]) => new Map(summarizeRentals(events, T0).map((r) => [r.address.toLowerCase(), r]));
    expect(scooterState(scooter, map([created()])).state).toBe("booked");
    expect(scooterState(scooter, map([created(), ev(LEASE, "Funded", { deposit: DEPOSIT, firstRent: RENT, startTime: T0 }, T0)])).state).toBe("rented");
    expect(scooterState(scooter, map([created(), ev(LEASE, "Funded", { deposit: DEPOSIT, firstRent: RENT }, T0), ev(LEASE, "SettlementProposed", { proposer: RENTER }, T0)])).state).toBe("inspection");
    expect(scooterState(scooter, map([created(), ev(LEASE, "Cancelled", {}, T0)])).state).toBe("available");
    expect(scooterState({ ...scooter, rentals: [] }, new Map(), [{ id: "b", scooterId: "s", renter: RENTER, createdAt: "", status: "requested" }]).state).toBe("booked");
  });
});
