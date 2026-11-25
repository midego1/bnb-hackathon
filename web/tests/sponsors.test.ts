import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bufferedDeposit, computeBuffer, dailyVolatility } from "@/lib/risk";
import { readFeed } from "@/lib/server/price";
import { RiskService } from "@/lib/server/risk";
import { proposeSettlement, memoryNotes } from "@/lib/server/settlement";
import { cmcQuotes } from "@/lib/server/sponsors/cmc";
import { cournotConfig, CournotError, depositClaim, evaluateClaim, readProbability } from "@/lib/server/sponsors/cournot";
import { inspectionMemoryFromEnv, LivingBrainMemory, livingBrainConfig, LocalInspectionMemory } from "@/lib/server/sponsors/livingbrain";
import { clearSponsorLog, recentSponsorCalls } from "@/lib/server/sponsors/log";

const fx = (p: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", p), "utf8"));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** CMC fake that serves the fixture matching ?convert=. */
function cmcFake() {
  return vi.fn(async (url: string | URL | Request) => {
    const convert = new URL(String(url)).searchParams.get("convert");
    return json(fx(convert === "THB" ? "cmc/quotes-thb.shape.json" : "cmc/quotes-usd.shape.json"));
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

afterEach(() => clearSponsorLog());

describe("risk buffer math", () => {
  it("gives a stablecoin no buffer and BNB a volatility buffer over the rental horizon", () => {
    const usdt = computeBuffer("USDT", { price: 1, percentChange24h: 0.01, percentChange7d: -0.02, percentChange30d: 0.03 }, 30);
    expect(usdt).toMatchObject({ buffer: 0, tier: "stable" });
    const bnb = computeBuffer("BNB", { price: 540, percentChange24h: -2.3, percentChange7d: -6.5, percentChange30d: -12 }, 30);
    expect(dailyVolatility({ price: 540, percentChange24h: -2.3, percentChange7d: -6.5, percentChange30d: -12 })).toBeCloseTo(0.0246, 3);
    expect(bnb.buffer).toBeGreaterThan(0.1);
    expect(bnb.buffer).toBeLessThan(0.25);
    expect(bnb.tier).toBe("moderate");
    expect(bnb.coverageFloorUsd).toBeLessThan(540);
    // Longer rentals are capped at 30 days of price risk; shorter ones get a smaller buffer.
    expect(computeBuffer("BNB", { price: 540, percentChange24h: -2.3 }, 365).horizonDays).toBe(30);
    expect(computeBuffer("BNB", { price: 540, percentChange24h: -2.3 }, 3).buffer).toBeLessThan(computeBuffer("BNB", { price: 540, percentChange24h: -2.3 }, 30).buffer);
  });

  it("scales the buffer by (1 + Cournot probability) and rejects extreme volatility", () => {
    const v = { price: 540, percentChange24h: -2.3, percentChange7d: -6.5, percentChange30d: -12 };
    const base = computeBuffer("BNB", v, 30);
    const withP = computeBuffer("BNB", v, 30, { claim: "x", probability: 0.5, at: "2026-11-25T00:00:00Z" });
    expect(withP.cournotBuffer).toBeCloseTo(base.cmcBuffer * 0.5, 4);
    expect(withP.buffer).toBeGreaterThan(base.buffer);
    expect(computeBuffer("BNB", { price: 1, percentChange24h: 30 }, 30).tier).toBe("rejected");
    expect(bufferedDeposit(3000, 17928, 0.2).thb).toBeCloseTo(3600);
  });
});

describe("CoinMarketCap", () => {
  it("sends the key only as a header and logs endpoint, status and credits without it", async () => {
    const f = cmcFake();
    const q = await cmcQuotes("secret-key-123", "USD", f);
    expect(q.BNB.price).toBe(540);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).not.toContain("secret-key-123");
    expect((init as RequestInit).headers).toMatchObject({ "X-CMC_PRO_API_KEY": "secret-key-123" });
    const [log] = await recentSponsorCalls("cmc");
    expect(log).toMatchObject({ sponsor: "cmc", status: 200, ok: true, note: "credits=1" });
    expect(log.endpoint).toBe("GET /v2/cryptocurrency/quotes/latest?symbol=USDT,BNB&convert=USD");
    expect(JSON.stringify(log)).not.toContain("secret-key-123");
  });

  it("logs a failed call with the CMC error message", async () => {
    const f = vi.fn(async () => json({ status: { error_code: 1002, error_message: "API key missing." } }, 401)) as unknown as typeof fetch;
    await expect(cmcQuotes("k", "USD", f)).rejects.toThrow(/401/);
    expect((await recentSponsorCalls("cmc"))[0]).toMatchObject({ ok: false, status: 401, note: "API key missing." });
  });
});

describe("RiskService", () => {
  it("reports 'not configured' without CMC_API_KEY and computes nothing", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const r = await new RiskService({}, f).assess(3000, 30);
    expect(r.cmc).toEqual({ configured: false, reason: expect.stringContaining("CMC_API_KEY") });
    expect(r.options).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("prices the deposit per token from CMC quotes and caches them", async () => {
    const f = cmcFake();
    const svc = new RiskService({ CMC_API_KEY: "k" }, f);
    const r = await svc.assess(3000, 30);
    expect(r.cmc).toMatchObject({ configured: true, ok: true, cached: false });
    expect(r.options!.USDT).toMatchObject({ buffer: 0, depositThb: 3000 });
    expect(r.options!.USDT.depositTokens).toBeCloseTo(3000 / 33.2, 3);
    expect(r.options!.BNB.buffer).toBeGreaterThan(0);
    expect(r.options!.BNB.depositThb).toBeCloseTo(3000 * (1 + r.options!.BNB.buffer));
    expect(r.cournot.claim).toMatch(/^Will BNB fall below \$\d+0 at any time before \d{4}-\d{2}-\d{2} 00:00 UTC\?$/);
    expect(r.cournot.live).toBe("disabled");
    await svc.assess(5000, 7);
    expect(f).toHaveBeenCalledTimes(2); // one USD + one THB call, then cache
  });
});

describe("Cournot", () => {
  const live = { base: "https://interface.cournot.ai", live: true };

  it("never enables live calls under test, even with COURNOT_LIVE=1", () => {
    expect(cournotConfig({ COURNOT_LIVE: "1", VITEST: "true" }).live).toBe(false);
    expect(() => cournotConfig({ COURNOT_API_BASE: "https://evil.example" })).toThrow();
  });

  it("refuses to call when live calls are disabled", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    await expect(evaluateClaim("Will BNB fall below $450 at any time before 2026-12-26 00:00 UTC?", { ...live, live: false }, f)).rejects.toBeInstanceOf(CournotError);
    expect(f).not.toHaveBeenCalled();
  });

  it("resolves the market, asks for the probability and keeps claim + evidence (fixtures)", async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/resolve")) return json(fx("cournot/resolve.recorded-2026-11-25.json"));
      expect(body.market_ids).toEqual(["1572"]);
      return json(fx("cournot/probability.shape.json"), 200, { "x-trace-id": "trace-abc" });
    }) as unknown as typeof fetch;
    const claim = "Will BNB fall below $450 at any time before 2026-12-26 00:00 UTC?";
    const r = await evaluateClaim(claim, live, f);
    expect(r).toMatchObject({ claim, marketId: "1572", probability: 0.12, requestId: "trace-abc", source: "live" });
    expect(r.marketTitle).toContain("BNB price below");
    expect(r.basis).toHaveProperty("primary_anchor");
    expect(JSON.stringify(r)).not.toContain("203.0.113.7"); // the caller IP is dropped
    const calls = await recentSponsorCalls("cournot");
    expect(calls.map((c) => c.endpoint)).toEqual(["POST /intelligence/v1/probability", "POST /intelligence/v1/resolve"]);
  });

  it("maps HTTP 402 to payment_required", async () => {
    const f = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/resolve") ? json(fx("cournot/resolve.recorded-2026-11-25.json")) : json({ code: 402, msg: "payment required" }, 402),
    ) as unknown as typeof fetch;
    await expect(evaluateClaim("Will BNB fall below $450 at any time before 2026-12-26 00:00 UTC?", live, f)).rejects.toMatchObject({ state: "payment_required" });
  });

  it("reads plain and nested probability shapes; builds claims with asset, threshold and date", () => {
    expect(readProbability({ probability: 0.3 }).probability).toBe(0.3);
    expect(readProbability({ result: { point_estimate: 0.04 } }).probability).toBe(0.04);
    expect(() => readProbability({})).toThrow();
    expect(depositClaim(446.2, new Date("2026-12-26T10:00:00Z"))).toBe("Will BNB fall below $450 at any time before 2026-12-26 00:00 UTC?");
  });
});

describe("Atlas push feed", () => {
  const addr = "0x0000000000000000000000000000000000000a71";
  const client = (answer: bigint, updatedAt: number) => ({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "decimals" ? 8 : [BigInt(1), answer, BigInt(updatedAt), BigInt(updatedAt), BigInt(1)],
    ),
  });

  it("accepts a fresh answer and rejects stale or never-updated ones", async () => {
    const now = 1_800_000_000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(readFeed(client(BigInt(54_000_000_000), now - 60) as any, addr, 3600, now)).resolves.toMatchObject({ value: 540 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(readFeed(client(BigInt(54_000_000_000), now - 7200) as any, addr, 3600, now)).rejects.toThrow(/stale/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(readFeed(client(BigInt(0), 0) as any, addr, 3600, now)).rejects.toThrow(/never updated/);
    const logs = await recentSponsorCalls("atlas");
    expect(logs.map((l) => l.ok)).toEqual([false, false, true]);
  });
});

describe("inspection memory (Living Brain)", () => {
  it("falls back to local memory with a clear reason when LIVING_BRAIN_* is missing", () => {
    const m = inspectionMemoryFromEnv({ LIVING_BRAIN_API_KEY: "k" });
    expect(m.status).toMatchObject({ provider: "local", configured: false });
    expect(m.status.reason).toContain("LIVING_BRAIN_SUBJECT_ID");
  });

  it("searches before judging and captures after, with the documented headers and bodies", async () => {
    const f = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/search")
        ? json([{ title: "Scooter BKK-123 inspection 2026-11-01", summary: "Scooter BKK-123: left mirror scratched (minor)", similarity: 0.8, status: "active" }, { title: "Other", summary: "Scooter XYZ", similarity: 0.5 }], 201)
        : json({ id: "src_1", status: "pending" }, 201),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const cfg = { ...livingBrainConfig({ LIVING_BRAIN_API_KEY: "lb", LIVING_BRAIN_SUBJECT_ID: "3f2b8c1e-7a4d-4e9b-9c2a-5d6e7f8a9b0c", LIVING_BRAIN_BRAIN_ID: "brn_1" }), configured: true };
    const mem = new LivingBrainMemory(cfg, f);
    const recalled = await mem.recall("BKK-123");
    expect(recalled).toHaveLength(1);
    expect(recalled[0].text).toContain("left mirror");
    const stored = await mem.remember({ scooterId: "BKK-123", at: "2026-11-25T00:00:00Z", findings: ["rear fender cracked"], newDamage: true, reportHash: "0xabc" });
    expect(stored).toEqual({ stored: true, id: "src_1" });
    const [searchUrl, searchInit] = f.mock.calls[0];
    expect(String(searchUrl)).toBe("https://api.livingbrain.com/v1/brains/brn_1/search");
    expect((searchInit as RequestInit).headers).toMatchObject({ "x-api-key": "lb", "x-subject-id": "3f2b8c1e-7a4d-4e9b-9c2a-5d6e7f8a9b0c" });
    const capture = JSON.parse(String((f.mock.calls[1][1] as RequestInit).body));
    expect(capture).toMatchObject({ kind: "note", originRef: "keyescrow:BKK-123:0xabc" });
    expect(capture.content).toContain("rear fender cracked");
  });

  it("feeds recalled damage to the inspector and writes the new inspection back", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mem-"));
    const mem = new LocalInspectionMemory(path.join(dir, "inspections.jsonl"), "local");
    await mem.remember({ scooterId: "BKK-123", at: "2026-11-01T00:00:00Z", findings: ["left mirror scratched (minor)"], newDamage: true });
    const assess = vi.fn(async () => ({ tenantRefund: 100, landlordClaim: 0, reasons: ["Mirror scratch is pre-existing (memory)."], confidence: 0.9 }));
    const photo = { hash: `0x${"a".repeat(64)}` };
    const store = { name: "local" as const, put: vi.fn(), get: vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: "image/png" as const })) };
    const r = await proposeSettlement(
      { deposit: "100000000", decimals: 6, currency: "USDT", checkIn: [photo], checkOut: [photo], scooterId: "BKK-123" },
      { provider: { name: "test", model: "m", assess }, store, memory: mem },
    );
    const notes = (assess.mock.calls[0] as unknown as [{ notes: string }])[0].notes;
    expect(notes).toContain("left mirror scratched");
    expect(notes).toContain("do NOT charge");
    expect(r.memory).toMatchObject({ provider: "local", scooterId: "BKK-123", recalled: [expect.stringContaining("left mirror")] });
    expect(r.memoryStored).toBe(true);
    expect(await mem.recall("BKK-123")).toHaveLength(2);
    expect(memoryNotes([])).toContain("no earlier inspections");
  });
});
