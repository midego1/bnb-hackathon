import { LeaseStatus } from "./contracts";
import type { Booking, FleetData, Plan, Rhythm, Scooter } from "./fleet";
import { rentPerPeriod, type RentalSummary } from "./rentals";

/**
 * Subscriptions on the escrow contract (no extra contract): a subscription is a normal rental with a long term and
 * the plan's rent period (7, 14 or 30 days), paid one period at a time by the renter (payRent(1)), and cancelled through the normal return check (photos, AI split, settle).
 * Which rentals are subscriptions is off-chain: the booking the owner turned into the rental carries the plan.
 * Pure, no I/O: unit-tested in tests/subscriptions.test.ts.
 */

/** Rhythms the selector shows: every rent period the contract supports. */
export const RHYTHMS: Rhythm[] = [7, 14, 30];
export const DEFAULT_MAX_PERIODS = 12;

export type Subscription = { booking: Booking; plan: Plan; scooter?: Scooter; rental?: RentalSummary };

/** The plan's on-chain rent per period (token units) from its monthly price already converted to tokens. */
export function planRent(monthly: bigint, plan: Plan): bigint {
  return rentPerPeriod(monthly, plan.periodDays * 86_400);
}

/** Every subscription in the fleet data, joined with its scooter and on-chain rental (if issued yet). */
export function subscriptionsOf(fleet: FleetData | undefined, rentals: RentalSummary[]): Subscription[] {
  const byAddress = new Map(rentals.map((r) => [r.address.toLowerCase(), r]));
  return (fleet?.bookings ?? []).flatMap((booking) =>
    booking.subscription && booking.status !== "declined"
      ? [{
          booking,
          plan: booking.subscription,
          scooter: fleet?.scooters.find((s) => s.id === booking.scooterId),
          rental: booking.lease ? byAddress.get(booking.lease.toLowerCase()) : undefined,
        }]
      : [],
  );
}

/** Running: funded and inside its term. A cancellation (return proposal) or dispute stops the recurring revenue. */
export function isActive(r: RentalSummary | undefined, now: bigint): r is RentalSummary {
  return !!r && r.status === LeaseStatus.Active && now < r.startTime + BigInt(r.termPeriods * r.rentPeriod);
}

/** Monthly recurring revenue (token base units) and the number of distinct active subscribers. */
export function mrr(subs: Subscription[], now: bigint): { mrr: bigint; subscribers: number } {
  const active = subs.filter((s) => isActive(s.rental, now));
  // Normalised to 30 days from the rental's own period, so a weekly plan counts 30/7 of its weekly rent per month.
  const total = active.reduce((sum, s) => sum + (s.rental!.rentAmount * BigInt(30 * 86_400)) / BigInt(s.rental!.rentPeriod), BigInt(0));
  return { mrr: total, subscribers: new Set(active.map((s) => s.rental!.tenant.toLowerCase())).size };
}

/** The next payment of a running subscription: period number (1-based), due date and amount; undefined when all is paid. */
export function nextPayment(r: RentalSummary, now: bigint): { period: number; due: bigint; amount: bigint; overdue: boolean } | undefined {
  if (r.status !== LeaseStatus.Active || r.periodsFunded >= r.termPeriods) return undefined;
  const due = r.startTime + BigInt(r.periodsFunded * r.rentPeriod);
  return { period: r.periodsFunded + 1, due, amount: r.rentAmount, overdue: now >= due };
}

export type SubState = "requested" | "issued" | "active" | "cancelling" | "disputed" | "ended";

/** Where a subscription stands, from its booking and rental. */
export function subState(s: Subscription): SubState {
  const r = s.rental;
  if (!r) return s.booking.status === "requested" ? "requested" : "issued";
  switch (r.status) {
    case LeaseStatus.Created:
      return "issued";
    case LeaseStatus.Active:
      return r.returnPhotos.length ? "cancelling" : "active";
    case LeaseStatus.MoveOut:
      return "cancelling";
    case LeaseStatus.Disputed:
      return "disputed";
    default:
      return "ended";
  }
}
