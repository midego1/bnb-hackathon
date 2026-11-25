import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN, explainFor } from "@/lib/demo/explain";
import { formatArgs, GUIDED, Pacer, parseTimeScale, readingMs, WPM } from "@/lib/demo/pacing";
import { newContext, stepsFor, type DemoPath } from "@/lib/demo/script";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("readingMs", () => {
  it("reads at 200 words per minute", () => {
    expect(WPM).toBe(200);
    expect(readingMs(words(40))).toBe(12_000);
    expect(readingMs(words(50), { minMs: 0 })).toBe(15_000);
  });

  it("never goes under the minimum (6 s by default), however short the text", () => {
    expect(readingMs("")).toBe(GUIDED.nowMinMs);
    expect(readingMs("Two words")).toBe(6_000);
    expect(readingMs(words(5), { minMs: 5_000 })).toBe(5_000);
  });

  it("caps very long text", () => {
    expect(readingMs(words(1_000))).toBe(GUIDED.maxMs);
    expect(readingMs(words(1_000), { maxMs: 20_000 })).toBe(20_000);
  });

  it("counts words, not punctuation or extra whitespace", () => {
    expect(readingMs(`${words(30)} — · →   \n  ,`, { minMs: 0 })).toBe(readingMs(words(30), { minMs: 0 }));
    expect(readingMs("฿36,000 ($1,090.91)", { minMs: 0 })).toBe(600);
  });
});

describe("parseTimeScale", () => {
  it("takes ?timescale= in (0, 10], else 1", () => {
    expect(parseTimeScale("?timescale=0.05")).toBe(0.05);
    expect(parseTimeScale("?autoplay=1&timescale=2")).toBe(2);
    expect(parseTimeScale("")).toBe(1);
    expect(parseTimeScale("?timescale=0")).toBe(1);
    expect(parseTimeScale("?timescale=-1")).toBe(1);
    expect(parseTimeScale("?timescale=abc")).toBe(1);
    expect(parseTimeScale("?timescale=100")).toBe(1);
  });
});

describe("formatArgs", () => {
  it("shortens addresses, shows token amounts in mUSDT and hides structs", () => {
    expect(formatArgs(undefined)).toBe("");
    expect(formatArgs(["0x5FbDB2315678afecb367f032d93F642f64180aa3", BigInt(1_636_350_000)])).toBe("0x5FbD…0aa3, 1,636.35 mUSDT");
    expect(formatArgs([1, { tenant: "0x" }])).toBe("1, {…}");
  });
});

describe("Pacer", () => {
  afterEach(() => vi.useRealTimers());
  const make = (o: Partial<{ paused: boolean; step: boolean; guided: boolean; alive: boolean }> = {}) => {
    const s = { paused: false, step: false, guided: true, alive: true, ...o };
    const pacer = new Pacer({ alive: () => s.alive, paused: () => s.paused, stepMode: () => s.step, guided: () => s.guided, scale: () => 1 });
    return { s, pacer };
  };
  const settle = async (p: Promise<boolean>) => {
    let done: boolean | undefined;
    void p.then((v) => (done = v));
    await vi.advanceTimersByTimeAsync(0);
    return () => done;
  };

  it("waits the given time, not counting paused time", async () => {
    vi.useFakeTimers();
    const { s, pacer } = make();
    const done = await settle(pacer.wait(1_000));
    await vi.advanceTimersByTimeAsync(500);
    s.paused = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(done()).toBeUndefined();
    expect(pacer.getSnapshot().frozen).toBe(true);
    s.paused = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(done()).toBe(true);
  });

  it("skip() ends the current wait; step-by-step captions wait for it", async () => {
    vi.useFakeTimers();
    const { pacer } = make({ step: true });
    const done = await settle(pacer.wait(1_000));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done()).toBeUndefined();
    expect(pacer.getSnapshot().untilClick).toBe(true);
    pacer.skip();
    await vi.advanceTimersByTimeAsync(200);
    expect(done()).toBe(true);
    // A timed wait (the line before a transaction) does not wait for a click.
    const timed = await settle(pacer.wait(300, "timed"));
    await vi.advanceTimersByTimeAsync(400);
    expect(timed()).toBe(true);
  });

  it("a skip with nothing waiting is ignored; outside Guided nothing waits; a restart cancels", async () => {
    vi.useFakeTimers();
    const a = make();
    a.pacer.skip();
    const done = await settle(a.pacer.wait(1_000));
    await vi.advanceTimersByTimeAsync(500);
    expect(done()).toBeUndefined();
    a.s.alive = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(done()).toBe(false);
    expect(await make({ guided: false }).pacer.wait(60_000)).toBe(true);
  });
});

describe("guided explanations", () => {
  const paths: DemoPath[] = ["happy", "dispute", "timeout", "fleet"];
  const money = (v: bigint) => `฿${v}`;

  it("explain every step of every story, before and after it ran", () => {
    for (const p of paths) {
      for (const step of stepsFor(p)) {
        expect(EXPLAIN[step.id], `${p}/${step.id}`).toBeDefined();
        const c = newContext(p, 0, 33);
        const e = explainFor(step.id);
        expect(e.now(c, money, { landlord: "landlord", tenant: "tenant" }).length).toBeGreaterThan(40);
        expect(e.changed(c, money, { landlord: "landlord", tenant: "tenant" }).length).toBeGreaterThan(40);
      }
    }
  });

  it("work for any rental: the sides come from the cast, the asset from the context", () => {
    const cast = { landlord: "owner", tenant: "renter" };
    const c = newContext("happy", 0, 33);
    c.inspection = { tenantRefund: "100", landlordClaim: "50" } as never;
    c.property = { name: "THE-ASSET", rentThb: 1 } as never;
    const all = Object.values(EXPLAIN).flatMap((e) => [e.now(c, money, cast), e.changed(c, money, cast)]);
    const text = all.join(" ");
    expect(text).not.toMatch(/\b(landlord|tenant|lease|apartment|condo|scooter|move-out|check-in)\b/i);
    expect(EXPLAIN.create.now(c, money, cast)).toContain("THE-ASSET");
  });

  it("fit the Guided pace: a happy path's captions read in under 2:40, so the whole run is about 3 minutes", () => {
    const c = newContext("happy", 0, 33);
    const cast = { landlord: "landlord", tenant: "tenant" };
    const ms = stepsFor("happy").reduce(
      (t, s) => t + readingMs(explainFor(s.id).now(c, money, cast)) + readingMs(explainFor(s.id).changed(c, money, cast), { minMs: GUIDED.changedMinMs }),
      0,
    );
    expect(ms).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(160_000);
  });
});
