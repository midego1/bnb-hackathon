import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, FleetStore, MAX_BOOKINGS, MAX_SCOOTERS, SEEDED_31337, SharedFleetStore, fleetActionSchema } from "@/lib/server/fleet";
import { getStage } from "@/lib/server/stage";
import { MemoryState } from "@/lib/server/state";
import { getAddress } from "viem";
import type { FleetData } from "@/lib/fleet";

const RENTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const LEASE = "0x00000000000000000000000000000000000000a1";

describe("fleet store", () => {
  it("links the demo fleet to the rentals Seed.s.sol creates on a fresh anvil", () => {
    const seeded = JSON.parse(readFileSync(path.resolve(__dirname, "../../contracts/deployments/31337.demo.example.json"), "utf8"));
    expect(seeded.lease).toBe(SEEDED_31337.lease);
    expect(seeded.disputedLease).toBe(SEEDED_31337.disputedLease);
    expect(seeded.fleetLease).toBe(SEEDED_31337.fleetLease);
  });

  it("adds scooters, books, offers and persists per chain", async () => {
    const store = new FleetStore(mkdtempSync(path.join(tmpdir(), "fleet-")));
    expect((await store.read(97)).scooters).toEqual([]);
    expect((await store.read(31337)).scooters.length).toBeGreaterThan(0);

    let data = await store.apply(97, fleetActionSchema.parse({ action: "addScooter", owner: RENTER.toLowerCase(), name: "Honda Wave", location: "Krabi", rentThb: 2500, depositThb: 5000, vault: true }));
    const id = data.scooters[0].id;
    expect(data.scooters[0]).toMatchObject({ id: "honda-wave-krabi", owner: RENTER, vault: true, rentals: [] });

    data = await store.apply(97, { action: "book", scooterId: id, renter: RENTER });
    data = await store.apply(97, { action: "book", scooterId: id, renter: RENTER }); // idempotent for the same renter
    expect(data.bookings).toHaveLength(1);
    await expect(store.apply(97, { action: "book", scooterId: id, renter: "0x0000000000000000000000000000000000000009" })).rejects.toThrow(/pending booking/);

    data = await store.apply(97, { action: "offer", bookingId: data.bookings[0].id, lease: LEASE });
    expect(data.bookings[0]).toMatchObject({ status: "offered", lease: LEASE });
    expect((await store.read(97)).scooters[0].rentals).toEqual([LEASE]);
    await expect(store.apply(97, { action: "book", scooterId: "nope", renter: RENTER })).rejects.toThrow(/unknown scooter/);
  });

  it("caps the record: refuses listings past MAX_SCOOTERS, keeps the newest MAX_BOOKINGS bookings", () => {
    const add = fleetActionSchema.parse({ action: "addScooter", owner: RENTER, name: "Click", location: "Pai", rentThb: 3000, depositThb: 6000, vault: false });
    const data: FleetData = { scooters: [], bookings: [] };
    for (let i = 0; i < MAX_SCOOTERS; i++) applyAction(data, add, "t");
    expect(() => applyAction(data, add, "t")).toThrow(/fleet is full/);
    for (let i = 0; i < MAX_BOOKINGS + 5; i++) {
      applyAction(data, { action: "book", scooterId: data.scooters[0].id, renter: RENTER }, `t${i}`);
      applyAction(data, { action: "decline", bookingId: data.bookings.at(-1)!.id }, `t${i}`);
    }
    expect(data.bookings).toHaveLength(MAX_BOOKINGS);
  });

  it("rejects bad input", () => {
    expect(fleetActionSchema.safeParse({ action: "addScooter", owner: "0x1", name: "x", location: "y", rentThb: 1, depositThb: 1, vault: false }).success).toBe(false);
    expect(fleetActionSchema.safeParse({ action: "addScooter", owner: RENTER, name: "Click", location: "Pai", rentThb: 3000, depositThb: 6000, vault: false, photo: "https://evil" }).success).toBe(false);
  });
});

describe("fleet reset (stage 'Reset stage')", () => {
  const PLAN = { priceThb: 3000, depositThb: 6000, maxPeriods: 6, periodDays: 30 } as const;
  async function used(store: FleetStore | SharedFleetStore) {
    let d = await store.apply(97, { action: "addScooter", owner: getAddress(RENTER), name: "Honda Click 125i", location: "Pai", rentThb: 3000, depositThb: 6000, vault: false });
    const id = d.scooters[0].id;
    await store.apply(97, { action: "offerPlan", scooterId: id, plan: PLAN });
    await store.apply(97, { action: "linkRental", scooterId: id, lease: getAddress(LEASE) });
    d = await store.apply(97, { action: "book", scooterId: id, renter: getAddress(RENTER) });
    expect(d.bookings).toHaveLength(1);
    return id;
  }
  const isReset = (d: FleetData, id: string) => {
    expect(d.scooters).toHaveLength(1);
    expect(d.scooters[0]).toMatchObject({ id, name: "Honda Click 125i", plan: PLAN, rentals: [] });
    expect(d.bookings).toEqual([]);
  };

  it("keeps every scooter and its plan, clears rental links and bookings, in the file store and the Durable Object store", async () => {
    const file = new FleetStore(mkdtempSync(path.join(tmpdir(), "fleet-")));
    const id = await used(file);
    isReset(await file.apply(97, { action: "reset" }), id);
    isReset(await file.read(97), id);

    const mem = new MemoryState();
    const shared = new SharedFleetStore(() => mem);
    const id2 = await used(shared);
    isReset(await shared.apply(97, { action: "reset" }), id2);
    isReset(await shared.read(97), id2);
  });

  it("is not a public fleet action", () => {
    expect(fleetActionSchema.safeParse({ action: "reset" }).success).toBe(false);
  });

  it("runs with the stage reset, behind the same presenter code", async () => {
    const mem = new MemoryState();
    const fleet = new SharedFleetStore(() => mem);
    const id = await used(fleet);
    const stage = getStage({ STAGE_DEMO: "1", NEXT_PUBLIC_CHAIN_ID: "97", STAGE_PRESENTER_CODE: "letmein" }, () => mem, () => fleet)!;
    await expect(stage.reset("mystery-box", "wrong")).rejects.toMatchObject({ status: 403 });
    expect((await fleet.read(97)).bookings).toHaveLength(1);
    await stage.reset("mystery-box", "letmein");
    isReset(await fleet.read(97), id);
  });
});
