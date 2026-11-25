import type { Address } from "viem";
import { LeaseStatus } from "./contracts";
import type { RentalSummary } from "./rentals";

/**
 * The scooter catalogue (off-chain listing data) and booking requests, served by /api/fleet. Money and rental state
 * never live here: every rental is its own on-chain escrow, linked to its scooter by address.
 */
export type Scooter = {
  id: string;
  /** Owner wallet (the rental shop / fleet operator). */
  owner: Address;
  name: string;
  location: string;
  photo: string;
  /** Monthly rent and deposit, in THB (converted to USDT at the rate of the day when a rental is offered). */
  rentThb: number;
  depositThb: number;
  /** Rentals of this scooter pay the owner's cut into the Fleet Vault (BKK-FLEET-1 shareholders). */
  vault: boolean;
  createdAt: string;
  /** On-chain rentals (escrow addresses) of this scooter, oldest first. */
  rentals: Address[];
};

export type BookingStatus = "requested" | "offered" | "declined";
export type Booking = {
  id: string;
  scooterId: string;
  renter: Address;
  createdAt: string;
  status: BookingStatus;
  /** Escrow the owner created for this booking. */
  lease?: Address;
};

export type FleetData = { scooters: Scooter[]; bookings: Booking[] };

export type FleetAction =
  | { action: "addScooter"; owner: Address; name: string; location: string; rentThb: number; depositThb: number; vault: boolean; photo?: string }
  | { action: "book"; scooterId: string; renter: Address }
  | { action: "offer"; bookingId: string; lease: Address }
  | { action: "decline"; bookingId: string }
  | { action: "linkRental"; scooterId: string; lease: Address };

export type ScooterState = "available" | "booked" | "rented" | "inspection" | "dispute";

export const scooterStateLabel: Record<ScooterState, string> = {
  available: "Available",
  booked: "Booked, awaiting payment",
  rented: "Rented",
  inspection: "In inspection",
  dispute: "In dispute",
};

/** A scooter's state from its latest on-chain rental. */
export function scooterState(s: Scooter, rentals: Map<string, RentalSummary>, bookings: Booking[] = []): { state: ScooterState; current?: RentalSummary } {
  for (let i = s.rentals.length - 1; i >= 0; i--) {
    const r = rentals.get(s.rentals[i].toLowerCase());
    if (!r) continue;
    if (r.status === LeaseStatus.Created) return { state: "booked", current: r };
    if (r.status === LeaseStatus.Disputed) return { state: "dispute", current: r };
    if (r.status === LeaseStatus.MoveOut || (r.status === LeaseStatus.Active && r.returnPhotos.length > 0)) return { state: "inspection", current: r };
    if (r.status === LeaseStatus.Active) return { state: "rented", current: r };
    break; // latest rental is closed
  }
  if (bookings.some((b) => b.scooterId === s.id && b.status === "requested")) return { state: "booked" };
  return { state: "available" };
}

/** Owner (or vault) income of a set of rentals: net rent paid out + deposit kept for damage. */
export function incomeOf(rentals: RentalSummary[]) {
  let rent = BigInt(0);
  let damage = BigInt(0);
  for (const r of rentals) {
    rent += r.totals.rentToOwner;
    damage += r.totals.slashed;
  }
  return { rent, damage, total: rent + damage };
}

export async function fetchFleet(chainId: number): Promise<FleetData> {
  const res = await fetch(`/api/fleet?chainId=${chainId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fleet API ${res.status}`);
  return res.json();
}

export async function postFleet(chainId: number, body: FleetAction): Promise<FleetData> {
  const res = await fetch(`/api/fleet?chainId=${chainId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `fleet API ${res.status}`);
  return json as FleetData;
}
