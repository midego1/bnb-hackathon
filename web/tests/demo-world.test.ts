import { parseEther, parseGwei } from "viem";
import { describe, expect, it } from "vitest";
import listings from "@/data/listings.json";
import world from "@/data/demo-world.json";
import {
  amounts,
  budget,
  buildPlan,
  cost,
  disputeSplit,
  FUNDER,
  GAS,
  loadState,
  newState,
  personaOf,
  remaining,
  thbToUnits,
  validateWorld,
  walletTarget,
  type CatalogueListing,
  type World,
} from "@/lib/demoWorld.mts";

// The demo world (pnpm testnet:world): the plan, its cost and budget guard, and the resumable state.

const W = world as World;
const catalogue = listings.listings as CatalogueListing[];
const plan = buildPlan(W);

describe("demo world file", () => {
  it("is valid against the catalogue: 3 shops, 10 renters, every outcome the demo needs", () => {
    expect(() => validateWorld(W, catalogue)).not.toThrow();
    expect(W.shops).toHaveLength(3);
    expect(W.renters).toHaveLength(10);
    const n = (o: string) => W.rentals.filter((r) => r.outcome === o).length;
    expect([n("clean"), n("damage"), n("dispute"), n("open-dispute"), n("active"), n("offer")]).toEqual([5, 2, 3, 1, 3, 1]);
    // Resolved disputes: one renter win, one owner win, one split.
    expect(W.rentals.filter((r) => r.ruling).map((r) => r.ruling!.ownerSharePct).sort((a, b) => a - b)).toEqual([0, 50, 100]);
    expect(W.rentals.filter((r) => r.outcome === "active" && r.prepay)).toHaveLength(1);
    expect(new Set(W.rentals.map((r) => r.periodDays))).toEqual(new Set([7, 14, 30]));
    // Every shop and every renter takes part; names are labelled demo.
    for (const s of W.shops) expect(s.name).toMatch(/\(demo\)$/);
    for (const p of [...W.shops, ...W.renters]) expect(W.rentals.some((r) => r.shop === p.id || r.renter === p.id)).toBe(true);
  });

  it("refuses a listing the shop does not own and a dispute without a ruling", () => {
    const bad = (patch: object) => ({ ...W, rentals: [{ ...W.rentals[0], ...patch }] });
    expect(() => validateWorld(bad({ listing: "yamaha-nmax-155" }), catalogue)).toThrow(/not a listing of cnx/);
    expect(() => validateWorld(bad({ outcome: "dispute", ownerClaimPct: 50 }), catalogue)).toThrow(/needs a ruling/);
    expect(() => validateWorld(bad({ prepay: 3 }), catalogue)).toThrow(/term too short/);
  });
});

describe("amounts", () => {
  it("prices from the catalogue in mUSDT at the fixed THB rate, rent per period = monthly x days / 30", () => {
    expect(thbToUnits(3400, 33)).toBe(BigInt(103_030_000));
    const r = { ...W.rentals[0], periodDays: 7 as const, prepay: 1, outcome: "active" as const }; // honda-click-125i: 3,400/month, 6,800 deposit
    const a = amounts(r, catalogue, 33);
    expect(a.rent).toBe(thbToUnits((3400 * 7) / 30, 33));
    expect(a.deposit).toBe(BigInt(206_060_000));
    expect(a.funded).toBe(a.deposit + a.rent * BigInt(2));
    expect(amounts({ ...r, outcome: "offer" }, catalogue, 33).funded).toBe(BigInt(0));
  });

  it("dispute split: owner's claim, then the desk's share of it", () => {
    const d = BigInt(300_000_000);
    const r = W.rentals.find((x) => x.id === "r10")!; // claim 50%, desk gives the owner half of it
    expect(disputeSplit(r, d)).toEqual({ claim: BigInt(150_000_000), ownerProposalRefund: BigInt(150_000_000), rulingRefund: BigInt(225_000_000) });
    expect(disputeSplit(W.rentals.find((x) => x.id === "r08")!, d).rulingRefund).toBe(d); // renter wins
  });
});

describe("plan", () => {
  it("orders each rental's steps and keeps keys unique", () => {
    expect(new Set(plan.map((s) => s.key)).size).toBe(plan.length);
    const keys = (id: string) => plan.filter((s) => s.key.startsWith(`${id}:`)).map((s) => s.key.slice(id.length + 1));
    expect(keys("r08")).toEqual(["create", "link", "approve", "fund", "photos:pickup", "evidence:pickup:0", "evidence:pickup:1", "photos:return", "evidence:return:0", "evidence:return:1", "ai", "propose", "dispute", "resolve", "history"]);
    expect(keys("r01").slice(-4)).toEqual(["ai", "propose", "accept", "history"]);
    expect(keys("r11").slice(-3)).toEqual(["ai", "propose", "dispute"]);
    expect(keys("r12")).toEqual(["create", "link", "approve", "fund", "prepay", "photos:pickup", "evidence:pickup:0", "evidence:pickup:1", "release"]);
    expect(keys("r15")).toEqual(["create", "link"]);
    // Funding comes before any rental; the desk (funder) resolves.
    expect(plan.findIndex((s) => s.key.startsWith("r01:"))).toBeGreaterThan(plan.findIndex((s) => s.key === "usdt:noah"));
    expect(plan.find((s) => s.key === "r09:resolve")).toMatchObject({ actor: FUNDER });
  });

  it("costs: AI calls, Living Brain writes within budget, gas per wallet", () => {
    const c = cost(plan);
    expect(c.aiCalls).toBe(11); // every returned rental, at most ~12 Claude calls
    expect(c.historyCalls).toBe(10);
    expect(c.livingBrainWrites).toBe(31); // <= ~40
    expect(c.livingBrainWrites).toBeLessThanOrEqual(40);
    expect(c.gasBy.hkt).toBe(GAS.createLease * BigInt(5) + GAS.accept * BigInt(2) + GAS.propose * BigInt(3));
    expect(c.gas).toBe(Object.values(c.gasBy).reduce((a, b) => a + b, BigInt(0)));
  });
});

describe("budget guard", () => {
  const price = parseGwei("1.1");
  const c = cost(plan);
  it("adds each wallet's top-up (with margin, minus what it holds) to the funder's own gas", () => {
    const b = budget(c, price, parseEther("1"), {});
    const topUps = Object.entries(c.gasBy).filter(([k]) => k !== FUNDER).reduce((s, [, g]) => s + walletTarget(g, price), BigInt(0));
    expect(b.topUps).toBe(topUps);
    expect(b.own).toBe(c.gasBy[FUNDER] * price);
    expect(b.ok).toBe(true);
    // A wallet that already holds enough needs nothing.
    expect(budget(c, price, parseEther("1"), { hkt: parseEther("1") }).topUps).toBe(topUps - walletTarget(c.gasBy.hkt, price));
  });

  it("refuses when the run would leave the funder under the 0.02 tBNB reserve", () => {
    const need = budget(c, price, parseEther("1"), {}).need;
    expect(budget(c, price, need + parseEther("0.02"), {}).ok).toBe(true);
    expect(budget(c, price, need + parseEther("0.02") - BigInt(1), {}).ok).toBe(false);
  });
});

describe("state (resume)", () => {
  const FACTORY = "0x04D7dDCb72802aF82296110A90526342C1249315";
  it("continues where it stopped: done steps drop out of the plan and the cost", () => {
    const s = newState(97, FACTORY);
    for (const step of plan.slice(0, 50)) s.steps[step.key] = { done: true };
    s.steps[plan[50].key] = { pending: "0xabc" }; // broadcast before a crash: still to finish
    const again = loadState(JSON.stringify(s), 97, FACTORY);
    expect(remaining(plan, again).map((x) => x.key)).toEqual(plan.slice(50).map((x) => x.key));
    expect(cost(remaining(plan, again)).txs).toBeLessThan(cost(plan).txs);
    for (const step of plan) again.steps[step.key] = { done: true };
    expect(remaining(plan, again)).toHaveLength(0);
  });

  it("refuses a state file of another chain or factory, and starts fresh without one", () => {
    const s = JSON.stringify(newState(97, FACTORY));
    expect(() => loadState(s, 31337, FACTORY)).toThrow(/chain 97/);
    expect(() => loadState(s, 97, "0x0000000000000000000000000000000000000001")).toThrow(/new world/);
    expect(loadState(undefined, 97, FACTORY).steps).toEqual({});
  });
});

describe("demo persona lookup", () => {
  it("names a world wallet on its chain only, case-insensitive", () => {
    const addresses = { "97": { anna: "0x00000000000000000000000000000000000000Aa", hkt: "0x00000000000000000000000000000000000000bB" } };
    expect(personaOf(W, addresses, 97, "0x00000000000000000000000000000000000000aa")).toMatchObject({ name: "Anna", kind: "renter", flag: "🇩🇪" });
    expect(personaOf(W, addresses, 97, "0x00000000000000000000000000000000000000BB")).toMatchObject({ name: "Phuket Island Rides (demo)", kind: "shop" });
    expect(personaOf(W, addresses, 31337, "0x00000000000000000000000000000000000000aa")).toBeUndefined();
    expect(personaOf(W, addresses, 97, undefined)).toBeUndefined();
  });
});
