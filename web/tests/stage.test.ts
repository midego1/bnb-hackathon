import { parseEther, parseUnits, zeroHash, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { ATTEMPTS, fitUnder, MAX_PHOTO_BYTES } from "@/components/stage/photo";
import { getListing } from "@/lib/listings";
import { MemoryState } from "@/lib/server/state";
import { evidenceStoreFromEnv, StateEvidenceStore, storeEvidence } from "@/lib/server/evidence";
import { STATE_EVIDENCE_MAX_BYTES, STATE_EVIDENCE_MAX_FILES, STATE_EVIDENCE_TTL_MS } from "@/lib/server/evidence/state";
import {
  DRIP_PENDING_MS,
  DRIP_TBNB,
  dripDecision,
  dripPlan,
  FUNDER_FLOOR,
  MAX_MUSDT_DRIP,
  presenterAllowed,
  StageError,
  stageConfig,
  thbToUnits,
} from "@/lib/server/stage/guards";
import { judgeStep, MIN_GAS_WEI, replaceable, STALE_OFFER_MS, type StageStatus } from "@/lib/stage";

const ME = "0x00000000000000000000000000000000000000a1" as Address;
const OTHER = "0x00000000000000000000000000000000000000b2" as Address;
const LEASE = "0x00000000000000000000000000000000000000c3" as Address;
const H = `0x${"ab".repeat(32)}` as const;

describe("stage config", () => {
  it("is off unless STAGE_DEMO=1 on chain 97 or 31337", () => {
    expect(stageConfig({})).toBeUndefined();
    expect(stageConfig({ STAGE_DEMO: "1", NEXT_PUBLIC_CHAIN_ID: "56" })).toBeUndefined();
    expect(stageConfig({ STAGE_DEMO: "1", NEXT_PUBLIC_CHAIN_ID: "5611" })).toBeUndefined();
    expect(stageConfig({ STAGE_DEMO: "1", NEXT_PUBLIC_CHAIN_ID: "97" })?.chainId).toBe(97);
    expect(stageConfig({ STAGE_DEMO: "1" })?.chainId).toBe(31337);
  });

  it("clamps the hourly caps", () => {
    expect(stageConfig({ STAGE_DEMO: "1", STAGE_DRIPS_PER_HOUR: "100000" })?.dripsPerHour).toBe(200);
    expect(stageConfig({ STAGE_DEMO: "1", STAGE_LEASES_PER_HOUR: "0" })?.leasesPerHour).toBe(1);
  });
});

describe("drip caps", () => {
  const rich = parseEther("1");
  const need = parseUnits("36.37", 6);

  it("tops gas up to 0.002 tBNB and mUSDT to rent + deposit + 10 %, never more", () => {
    expect(dripPlan({ bnb: BigInt(0), musdt: BigInt(0), need, funderBnb: rich })).toEqual({ bnb: DRIP_TBNB, musdt: parseUnits("40.007", 6) });
    expect(dripPlan({ bnb: parseEther("0.0015"), musdt: need, funderBnb: rich, need })).toEqual({ bnb: parseEther("0.0005"), musdt: parseUnits("3.637", 6) });
    expect(dripPlan({ bnb: parseEther("5"), musdt: parseUnits("999", 6), need, funderBnb: rich })).toEqual({ bnb: BigInt(0), musdt: BigInt(0) });
  });

  it("never mints over the MockUSDT faucet limit", () => {
    expect(dripPlan({ bnb: BigInt(0), musdt: BigInt(0), need: parseUnits("50000", 6), funderBnb: rich }).musdt).toBe(MAX_MUSDT_DRIP);
  });

  it("refuses when the funder would drop under its floor", () => {
    expect(() => dripPlan({ bnb: BigInt(0), musdt: BigInt(0), need, funderBnb: FUNDER_FLOOR })).toThrow(StageError);
  });

  it("is once per address: a done drip repeats its answer, a fresh pending one waits, a stale one may retry", () => {
    expect(dripDecision(undefined, 1_000)).toBe("claim");
    expect(dripDecision({ state: "done", at: 0, txs: [] }, 10 ** 12)).toBe("done");
    expect(dripDecision({ state: "pending", at: 1_000 }, 2_000)).toBe("pending");
    expect(dripDecision({ state: "pending", at: 1_000 }, 1_000 + DRIP_PENDING_MS + 1)).toBe("claim");
  });
});

describe("prices and presenter", () => {
  it("converts THB to mUSDT rounding up to the cent", () => {
    expect(thbToUnits(200, 33)).toBe(parseUnits("6.07", 6));
    expect(thbToUnits(1000, 33)).toBe(parseUnits("30.31", 6));
    expect(thbToUnits(330, 33)).toBe(parseUnits("10", 6));
    expect(() => thbToUnits(200, 0)).toThrow(StageError);
  });

  it("the seed listing is the Mystery Box at 200 / 1,000 THB", () => {
    expect(getListing("mystery-box")).toMatchObject({ name: "KeyEscrow Mystery Box", rentThb: 200, depositThb: 1000 });
  });

  it("presenter buttons are open without a code, closed with a wrong one", () => {
    expect(presenterAllowed({}, undefined)).toBe(true);
    expect(presenterAllowed({ presenterCode: "box42" }, "box42")).toBe(true);
    expect(presenterAllowed({ presenterCode: "box42" }, "box43")).toBe(false);
    expect(presenterAllowed({ presenterCode: "box42" }, undefined)).toBe(false);
  });
});

describe("judge steps (resume from chain state)", () => {
  const price = { rent: parseUnits("6.07", 6), deposit: parseUnits("30.31", 6), thbPerUsdt: 33 };
  const base = { chainId: 31337, listing: getListing("mystery-box")!, owner: OTHER, price, events: [], presenterLocked: false } as unknown as StageStatus;
  const lease = (status: string, more: Record<string, unknown> = {}) =>
    ({ address: LEASE, status, checkInHash: zeroHash, checkOutHash: zeroHash, proposal: {}, terms: {}, ...more }) as unknown as StageStatus["lease"];
  const rich = { address: ME, bnb: MIN_GAS_WEI, musdt: price.rent + price.deposit };
  const mine = (l: StageStatus["lease"], createdAt = Date.now()) => ({ ...base, me: rich, rental: { lease: LEASE, renter: ME, createdAt }, lease: l });

  it("walks wallet -> money -> rent with no rental yet", () => {
    expect(judgeStep(base, undefined)).toBe("wallet");
    expect(judgeStep(base, ME)).toBe("money");
    expect(judgeStep({ ...base, me: { ...rich, bnb: BigInt(0) } }, ME)).toBe("money");
    expect(judgeStep({ ...base, me: rich }, ME)).toBe("rent");
  });

  it("follows the renter's own rental through every state", () => {
    expect(judgeStep(mine(lease("Created")), ME)).toBe("fund");
    expect(judgeStep(mine(lease("Active")), ME)).toBe("pickup");
    expect(judgeStep(mine(lease("Active", { checkInHash: H })), ME)).toBe("return");
    expect(judgeStep(mine(lease("Active", { checkInHash: H, checkOutHash: H })), ME)).toBe("inspect");
    expect(judgeStep(mine(lease("MoveOut")), ME)).toBe("waiting");
    expect(judgeStep(mine(lease("Settled")), ME)).toBe("settled");
  });

  it("one rental at a time: someone else's open rental is busy until it settles or goes stale", () => {
    const now = Date.now();
    expect(judgeStep(mine(lease("Active")), OTHER)).toBe("busy");
    expect(judgeStep({ ...base, me: rich, creating: { renter: ME, at: now } }, OTHER)).toBe("busy");
    expect(judgeStep({ ...mine(lease("Settled")), me: { ...rich, address: OTHER } }, OTHER)).toBe("rent");
    expect(replaceable(mine(lease("Created"), now - STALE_OFFER_MS - 1), now)).toBe(true);
    expect(replaceable(mine(lease("Created"), now), now)).toBe(false);
    expect(replaceable(mine(lease("Active"), now - 10 * STALE_OFFER_MS), now)).toBe(false);
  });
});

describe("photo compression", () => {
  const blob = (size: number) => new Blob([new Uint8Array(size)]);

  it("returns the first encoding under 200 KB, shrinking quality then size", async () => {
    const tried: [number, number][] = [];
    const out = await fitUnder(MAX_PHOTO_BYTES, async (side, q) => {
      tried.push([side, q]);
      return blob(Math.round(side * side * q * 0.3)); // a rough JPEG size model
    });
    expect(out.size).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(tried[0]).toEqual(ATTEMPTS[0]);
    expect(tried.length).toBeGreaterThan(1);
  });

  it("gives up with a plain message when nothing fits", async () => {
    await expect(fitUnder(10, async () => blob(11))).rejects.toThrow(/could not be made small enough/);
  });
});

describe("evidence in the Durable Object (no R2 on Workers)", () => {
  const JPEG = (n: number) => {
    const b = new Uint8Array(n);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    b[n - 1] = n % 251; // distinct content per size
    return b;
  };

  it("is used on Workers when the state binding exists but no R2 bucket", () => {
    const state = new MemoryState();
    expect(evidenceStoreFromEnv({}, { cloudflare: true, state: () => state })).toBeInstanceOf(StateEvidenceStore);
  });

  it("stores and serves small photos, idempotently", async () => {
    const state = new MemoryState();
    const store = new StateEvidenceStore(() => state);
    const rec = await storeEvidence(store, JPEG(1000), "a.jpg");
    await storeEvidence(store, JPEG(1000), "again.jpg");
    expect(rec.storage).toBe("state");
    expect((await store.get(rec.hash))?.bytes.byteLength).toBe(1000);
    expect((await state.get<unknown[]>("evidence:index"))?.value).toHaveLength(1);
  });

  it("caps the size per file and the number of files", async () => {
    const state = new MemoryState();
    const store = new StateEvidenceStore(() => state);
    await expect(storeEvidence(store, JPEG(STATE_EVIDENCE_MAX_BYTES + 1), "big.jpg")).rejects.toMatchObject({ status: 507 });
    await state.set("evidence:index", 0, Array.from({ length: STATE_EVIDENCE_MAX_FILES }, (_, i) => [`0x${i}`, Date.now() + 60_000]));
    await expect(storeEvidence(store, JPEG(500), "full.jpg")).rejects.toMatchObject({ status: 507 });
  });

  it("expires files after 7 days", async () => {
    let now = 1_000_000;
    const state = new MemoryState(() => now);
    const store = new StateEvidenceStore(() => state, () => now);
    const rec = await storeEvidence(store, JPEG(600), "a.jpg");
    now += STATE_EVIDENCE_TTL_MS + 1;
    expect(await store.get(rec.hash)).toBeNull();
    // and the expired slot no longer counts towards the cap
    await storeEvidence(store, JPEG(700), "b.jpg");
    expect((await state.get<unknown[]>("evidence:index"))?.value).toHaveLength(1);
  });
});
