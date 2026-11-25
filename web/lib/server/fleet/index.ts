import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import type { Env } from "../env";
import { onCloudflare } from "../platform";
import { getSharedState, update, type SharedState } from "../state";
import type { Booking, FleetAction, FleetData, Scooter } from "@/lib/fleet";

/**
 * File-backed scooter catalogue + booking requests (web/.fleet/<chainId>.json, gitignored; FLEET_DIR overrides).
 * Off-chain listing data only: rental money and state live in the escrows. A fresh local anvil chain starts with
 * the demo fleet below, linked to the rentals contracts/script/Seed.s.sol creates.
 */
export function fleetDir(env: Env = process.env) {
  return env.FLEET_DIR ? path.resolve(env.FLEET_DIR) : path.join(process.cwd(), ".fleet");
}

const DEMO_OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil account #1, the demo fleet owner
const PHOTO = "/demo/walkthrough/checkin-left-side.png";

/**
 * Seeded rentals on a fresh anvil (deterministic; must match contracts/deployments/31337.demo.example.json, checked
 * by tests/fleet.test.ts): `lease` (active), `disputedLease` (in dispute) and `fleetLease` (paying the Fleet Vault).
 */
export const SEEDED_31337 = {
  lease: "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e",
  disputedLease: "0xbf9fBFf01664500A33080Da5d437028b07DFcC55",
  fleetLease: "0x93b6BDa6a0813D808d75aA42e900664Ceb868bcF",
} as const;

function demoFleet(chainId: number): FleetData {
  if (chainId !== 31337) return { scooters: [], bookings: [] };
  const at = "2026-11-20T09:00:00.000Z";
  const s = (id: string, name: string, location: string, rentThb: number, vault: boolean, rentals: string[]): Scooter => ({
    id,
    owner: DEMO_OWNER,
    name,
    location,
    photo: PHOTO,
    rentThb,
    depositThb: rentThb * 2,
    vault,
    createdAt: at,
    rentals: rentals as Address[],
  });
  return {
    scooters: [
      s("click-125i-cnx", "Honda Click 125i", "Chiang Mai Old City", 3_400, false, [SEEDED_31337.lease]),
      s("scoopy-i-pai", "Honda Scoopy-i", "Pai", 3_000, false, [SEEDED_31337.disputedLease]),
      s("nmax-155-patong", "Yamaha NMAX 155", "Patong, Phuket", 5_500, true, [SEEDED_31337.fleetLease]),
      s("pcx-160-bkk", "Honda PCX 160", "Sukhumvit, Bangkok", 4_800, true, []),
      s("fino-125-bkk", "Yamaha Fino 125", "Silom, Bangkok", 2_800, true, []),
    ],
    bookings: [],
  };
}

const address = z.string().refine(isAddress, "not an address").transform((a) => getAddress(a));
export const fleetActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addScooter"),
    owner: address,
    name: z.string().trim().min(2).max(60),
    location: z.string().trim().min(2).max(60),
    rentThb: z.number().int().min(100).max(1_000_000),
    depositThb: z.number().int().min(100).max(1_000_000),
    vault: z.boolean(),
    photo: z.string().regex(/^\/(demo\/[\w./-]+|api\/evidence\/0x[0-9a-f]{64})$/).optional(),
  }),
  z.object({ action: z.literal("book"), scooterId: z.string().min(1).max(80), renter: address }),
  z.object({ action: z.literal("offer"), bookingId: z.string().min(1).max(80), lease: address }),
  z.object({ action: z.literal("decline"), bookingId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("linkRental"), scooterId: z.string().min(1).max(80), lease: address }),
]);

export class FleetError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export class FleetStore {
  // One writer at a time per process: requests queue on this promise.
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string = fleetDir()) {}

  private file(chainId: number) {
    return path.join(this.dir, `${chainId}.json`);
  }

  async read(chainId: number): Promise<FleetData> {
    try {
      return JSON.parse(await readFile(this.file(chainId), "utf8")) as FleetData;
    } catch {
      return demoFleet(chainId);
    }
  }

  private async write(chainId: number, data: FleetData) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(chainId)}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, this.file(chainId));
  }

  apply(chainId: number, action: FleetAction): Promise<FleetData> {
    const run = this.queue.then(async () => {
      const data = await this.read(chainId);
      applyAction(data, action, new Date().toISOString());
      await this.write(chainId, data);
      return data;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scooter";
}

/** Unsigned requests can add listings and bookings: cap the per-chain record so spam cannot grow it without end. */
export const MAX_SCOOTERS = 200;
export const MAX_BOOKINGS = 500;

/** Mutates `data` with one action. Exported for tests. */
export function applyAction(data: FleetData, a: FleetAction, now: string) {
  const scooter = (id: string) => {
    const s = data.scooters.find((x) => x.id === id);
    if (!s) throw new FleetError(`unknown scooter ${id}`, 404);
    return s;
  };
  const booking = (id: string): Booking => {
    const b = data.bookings.find((x) => x.id === id);
    if (!b) throw new FleetError(`unknown booking ${id}`, 404);
    return b;
  };
  const link = (s: Scooter, lease: Address) => {
    if (!s.rentals.some((r) => r.toLowerCase() === lease.toLowerCase())) s.rentals.push(lease);
  };
  switch (a.action) {
    case "addScooter": {
      if (data.scooters.length >= MAX_SCOOTERS) throw new FleetError(`the demo fleet is full (${MAX_SCOOTERS} scooters)`, 409);
      let id = slug(`${a.name} ${a.location}`);
      for (let i = 2; data.scooters.some((s) => s.id === id); i++) id = `${slug(`${a.name} ${a.location}`)}-${i}`;
      data.scooters.push({
        id,
        owner: a.owner,
        name: a.name,
        location: a.location,
        photo: a.photo ?? PHOTO,
        rentThb: a.rentThb,
        depositThb: a.depositThb,
        vault: a.vault,
        createdAt: now,
        rentals: [],
      });
      return;
    }
    case "book": {
      scooter(a.scooterId);
      const open = data.bookings.find((b) => b.scooterId === a.scooterId && b.status === "requested");
      if (open && open.renter.toLowerCase() !== a.renter.toLowerCase()) throw new FleetError("this scooter already has a pending booking", 409);
      if (!open) data.bookings.push({ id: randomUUID(), scooterId: a.scooterId, renter: a.renter, createdAt: now, status: "requested" });
      data.bookings.splice(0, data.bookings.length - MAX_BOOKINGS); // oldest go first
      return;
    }
    case "offer": {
      const b = booking(a.bookingId);
      b.status = "offered";
      b.lease = a.lease;
      link(scooter(b.scooterId), a.lease);
      return;
    }
    case "decline":
      booking(a.bookingId).status = "declined";
      return;
    case "linkRental":
      link(scooter(a.scooterId), a.lease);
      return;
  }
}

/**
 * The same store on Cloudflare Workers (no disk, memory per isolate): one record per chain in the KeyEscrowState
 * Durable Object, changed with an atomic read-modify-write instead of the file + process queue.
 */
export class SharedFleetStore {
  constructor(private readonly state: () => SharedState = getSharedState) {}

  private key(chainId: number) {
    return `fleet:${chainId}`;
  }

  async read(chainId: number): Promise<FleetData> {
    return (await this.state().get<FleetData>(this.key(chainId)))?.value ?? demoFleet(chainId);
  }

  apply(chainId: number, action: FleetAction): Promise<FleetData> {
    return update<FleetData, FleetData>(this.state(), this.key(chainId), (cur) => {
      const data = cur ?? demoFleet(chainId);
      applyAction(data, action, new Date().toISOString());
      return { value: data, result: data };
    });
  }
}

let cached: FleetStore | null = null;
export function getFleetStore(): Pick<FleetStore, "read" | "apply"> {
  if (onCloudflare()) return new SharedFleetStore();
  cached ??= new FleetStore();
  return cached;
}
