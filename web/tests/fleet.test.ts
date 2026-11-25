import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FleetStore, SEEDED_31337, fleetActionSchema } from "@/lib/server/fleet";

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

  it("rejects bad input", () => {
    expect(fleetActionSchema.safeParse({ action: "addScooter", owner: "0x1", name: "x", location: "y", rentThb: 1, depositThb: 1, vault: false }).success).toBe(false);
    expect(fleetActionSchema.safeParse({ action: "addScooter", owner: RENTER, name: "Click", location: "Pai", rentThb: 3000, depositThb: 6000, vault: false, photo: "https://evil" }).success).toBe(false);
  });
});
