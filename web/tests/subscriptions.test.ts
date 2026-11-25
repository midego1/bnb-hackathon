import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import type { Booking, FleetData, Plan } from "@/lib/fleet";
import { RENT_PERIOD, type RentalSummary } from "@/lib/rentals";
import { applyAction } from "@/lib/server/fleet";
import { mrr, nextPayment, subState, subscriptionsOf, type Subscription } from "@/lib/subscriptions";

const T0 = BigInt(1_790_000_000);
const P = BigInt(RENT_PERIOD);
const RENT = BigInt(100_000_000); // 100 mUSDT
const PLAN: Plan = { priceThb: 3_400, depositThb: 6_800, maxPeriods: 12, periodDays: 30 };

function rental(over: Partial<RentalSummary> = {}): RentalSummary {
  return {
    address: "0x00000000000000000000000000000000000000a1", landlord: "0x0000000000000000000000000000000000000001",
    tenant: "0x0000000000000000000000000000000000000002", status: LeaseStatus.Active, startTime: T0, termMonths: 12,
    monthsFunded: 1, monthsReleased: 0, rentAmount: RENT, returnPhotos: [],
    ...over,
  } as RentalSummary;
}
const sub = (r?: RentalSummary, plan: Plan = PLAN): Subscription => ({ booking: { status: "offered" } as Booking, plan, rental: r });

describe("mrr", () => {
  it("sums active subscriptions, counts distinct renters, skips the rest", () => {
    const subs = [
      sub(rental()),
      sub(rental({ address: "0x00000000000000000000000000000000000000a2" })), // same renter, second scooter
      sub(rental({ tenant: "0x0000000000000000000000000000000000000003", status: LeaseStatus.MoveOut })), // cancelling
      sub(rental({ status: LeaseStatus.Created, startTime: BigInt(0) })), // not funded yet
      sub(rental({ termMonths: 2 })), // term over at T0 + 2P
      sub(undefined), // requested, no rental
    ];
    expect(mrr(subs, T0 + P)).toEqual({ mrr: RENT * BigInt(3), subscribers: 1 });
    expect(mrr(subs, T0 + P * BigInt(2))).toEqual({ mrr: RENT * BigInt(2), subscribers: 1 });
  });

  it("normalises shorter rhythms to 30 days (contract v2)", () => {
    expect(mrr([sub(rental(), { ...PLAN, periodDays: 7 })], T0).mrr).toBe((RENT * BigInt(30)) / BigInt(7));
  });
});

describe("nextPayment", () => {
  it("is the first unpaid period, due one period per paid month after the start", () => {
    expect(nextPayment(rental(), T0)).toEqual({ period: 2, due: T0 + P, amount: RENT, overdue: false });
    expect(nextPayment(rental({ monthsFunded: 3 }), T0 + P * BigInt(4))).toEqual({ period: 4, due: T0 + P * BigInt(3), amount: RENT, overdue: true });
  });
  it("is undefined when the whole term is paid or the rental is not running", () => {
    expect(nextPayment(rental({ monthsFunded: 12 }), T0)).toBeUndefined();
    expect(nextPayment(rental({ status: LeaseStatus.MoveOut }), T0)).toBeUndefined();
  });
});

describe("subscriptions in the fleet store", () => {
  const RENTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
  const fleet = (): FleetData => ({
    scooters: [{ id: "s1", owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", name: "Click", location: "Ari", photo: "", rentThb: 3_000, depositThb: 6_000, vault: false, createdAt: "", rentals: [] }],
    bookings: [],
  });

  it("copies the listing's plan into the booking, and only when there is one", () => {
    const data = fleet();
    expect(() => applyAction(data, { action: "subscribe", scooterId: "s1", renter: RENTER }, "now")).toThrow(/not offered/);
    applyAction(data, { action: "offerPlan", scooterId: "s1", plan: PLAN }, "now");
    applyAction(data, { action: "subscribe", scooterId: "s1", renter: RENTER }, "now");
    expect(data.bookings[0]).toMatchObject({ renter: RENTER, status: "requested", subscription: PLAN });
    const [s] = subscriptionsOf(data, []);
    expect(subState(s)).toBe("requested");
    applyAction(data, { action: "offer", bookingId: data.bookings[0].id, lease: "0x00000000000000000000000000000000000000a1" }, "now");
    expect(subState(subscriptionsOf(data, [rental({ status: LeaseStatus.Created })])[0])).toBe("issued");
    expect(subState(subscriptionsOf(data, [rental()])[0])).toBe("active");
    expect(subState(subscriptionsOf(data, [rental({ status: LeaseStatus.Settled })])[0])).toBe("ended");
  });
});
