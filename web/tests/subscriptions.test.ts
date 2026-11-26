import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import type { Booking, FleetData, Plan } from "@/lib/fleet";
import type { RentalSummary } from "@/lib/rentals";
import { applyAction, fleetActionSchema } from "@/lib/server/fleet";
import { mrr, nextPayment, planRent, RHYTHMS, subState, subscriptionsOf, type Subscription } from "@/lib/subscriptions";

const T0 = BigInt(1_790_000_000);
const P = BigInt(30 * 86_400);
const RENT = BigInt(100_000_000); // 100 mUSDT
const PLAN: Plan = { priceThb: 3_400, depositThb: 6_800, maxPeriods: 12, periodDays: 30 };

function rental(over: Partial<RentalSummary> = {}): RentalSummary {
  return {
    address: "0x00000000000000000000000000000000000000a1", landlord: "0x0000000000000000000000000000000000000001",
    tenant: "0x0000000000000000000000000000000000000002", status: LeaseStatus.Active, startTime: T0, termPeriods: 12, rentPeriod: 30 * 86_400,
    periodsFunded: 1, periodsReleased: 0, rentAmount: RENT, returnPhotos: [],
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
      sub(rental({ termPeriods: 2 })), // term over at T0 + 2P
      sub(undefined), // requested, no rental
    ];
    expect(mrr(subs, T0 + P)).toEqual({ mrr: RENT * BigInt(3), subscribers: 1 });
    expect(mrr(subs, T0 + P * BigInt(2))).toEqual({ mrr: RENT * BigInt(2), subscribers: 1 });
  });

  it("normalises shorter rhythms to 30 days, from the rental's own rent period", () => {
    expect(mrr([sub(rental({ rentPeriod: 7 * 86_400 }), { ...PLAN, periodDays: 7 })], T0).mrr).toBe((RENT * BigInt(30)) / BigInt(7));
  });
});

describe("rhythms", () => {
  it("offers weekly, every 2 weeks and monthly; the rent per period is the monthly price x days / 30, rounded down", () => {
    expect(RHYTHMS).toEqual([7, 14, 30]);
    const monthly = BigInt(3_000_000_000); // 3,000 tokens a month
    expect(planRent(monthly, { ...PLAN, periodDays: 30 })).toBe(monthly);
    expect(planRent(monthly, { ...PLAN, periodDays: 14 })).toBe(BigInt(1_400_000_000));
    expect(planRent(BigInt(100), { ...PLAN, periodDays: 7 })).toBe(BigInt(23)); // 23.33 -> 23
  });
});

describe("nextPayment", () => {
  it("is the first unpaid period, due one rent period per paid period after the start", () => {
    expect(nextPayment(rental(), T0)).toEqual({ period: 2, due: T0 + P, amount: RENT, overdue: false });
    expect(nextPayment(rental({ periodsFunded: 3 }), T0 + P * BigInt(4))).toEqual({ period: 4, due: T0 + P * BigInt(3), amount: RENT, overdue: true });
  });
  it("follows a weekly rental's own period", () => {
    const W = BigInt(7 * 86_400);
    expect(nextPayment(rental({ rentPeriod: 7 * 86_400, periodsFunded: 2 }), T0)).toEqual({ period: 3, due: T0 + W * BigInt(2), amount: RENT, overdue: false });
  });
  it("is undefined when the whole term is paid or the rental is not running", () => {
    expect(nextPayment(rental({ periodsFunded: 12 }), T0)).toBeUndefined();
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
    for (const periodDays of [7, 14, 30]) expect(fleetActionSchema.safeParse({ action: "offerPlan", scooterId: "s1", plan: { ...PLAN, periodDays } }).success).toBe(true);
    expect(fleetActionSchema.safeParse({ action: "offerPlan", scooterId: "s1", plan: { ...PLAN, periodDays: 10 } }).success).toBe(false);
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
