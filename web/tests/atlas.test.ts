import { readFileSync } from "node:fs";
import path from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atlasBadge, atlasOut, planBnbSwap, quoteTrusted, swapRoute, type AtlasStatus } from "@/lib/atlas";
import { fmt } from "@/lib/i18n/locales";
import { body as en } from "@/lib/i18n/dictionaries/en/rental";
import { body as zh } from "@/lib/i18n/dictionaries/zh/rental";
import { encodeAbiParameters } from "viem";
import { fetchAtlas, readFeed } from "@/lib/server/price";
import { loadAtlas, verifyAtlasReport, type AtlasEnv } from "@/lib/server/price/atlas";
import { proposeSettlement } from "@/lib/server/settlement";
import { clearSponsorLog, recentSponsorCalls } from "@/lib/server/sponsors/log";

const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/atlas/pull-latest.shape.json"), "utf8"));
const TEST_SIGNER = fixture._testSigner as `0x${string}`;
const NOW = Date.parse("2026-11-26T10:10:00Z");
const nowSec = NOW / 1000;
const PRICE = BigInt("650000000000000000000"); // 650 USD/BNB, 18 decimals

const status = (over: Partial<AtlasStatus> = {}): AtlasStatus => ({
  ok: true,
  bnbUsdE18: PRICE.toString(),
  bnbUsd: 650,
  updatedAt: new Date(NOW - 30_000).toISOString(),
  maxAgeSec: 120,
  consensus: { score: 0.94, status: "HEALTHY" },
  fetchedAt: new Date(NOW).toISOString(),
  ...over,
});

afterEach(() => clearSponsorLog());

describe("Pay with BNB: min-out math", () => {
  it("sends enough BNB that 99 % of its Atlas value still covers what is missing", () => {
    const need = BigInt(6_500_000); // 6.5 mUSDT
    const plan = planBnbSwap(need, 6, status(), 97, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.atlasOut).toBe(atlasOut(plan.bnbIn, PRICE, 6));
    expect(plan.amountOutMin).toBe((plan.atlasOut * BigInt(99)) / BigInt(100));
    expect(plan.amountOutMin >= need).toBe(true);
    // 6.5 / (650 x 0.99) = 0.0101010... BNB (+1 base unit of rounding margin)
    expect(Number(plan.bnbIn) / 1e18).toBeCloseTo(6.5 / (650 * 0.99), 8);
  });

  it("works for an 18-decimal stablecoin and refuses above the BSC mainnet 1 USDT cap", () => {
    const one = BigInt(10) ** BigInt(18);
    const plan = planBnbSwap(one, 18, status(), 56, NOW);
    expect(plan.ok && plan.amountOutMin >= one).toBe(true);
    expect(planBnbSwap(one + BigInt(1), 18, status(), 56, NOW)).toEqual({ ok: false, why: "cap" });
    expect(planBnbSwap(one + BigInt(1), 18, status(), 97, NOW).ok).toBe(true);
  });

  it("refuses when the pool quote deviates more than 2 % from Atlas", () => {
    expect(quoteTrusted(BigInt(980), BigInt(1000))).toBe(true);
    expect(quoteTrusted(BigInt(1020), BigInt(1000))).toBe(true);
    expect(quoteTrusted(BigInt(979), BigInt(1000))).toBe(false);
    expect(quoteTrusted(BigInt(1021), BigInt(1000))).toBe(false);
    expect(quoteTrusted(BigInt(0), BigInt(0))).toBe(false);
  });

  it("routes through PancakeSwap V2 on mainnet and the AtlasSwapGuard elsewhere (none when not deployed)", () => {
    const token = "0x55d398326f99059fF775485246999027B3197955";
    expect(swapRoute(56, token, undefined)?.router).toBe("0x10ED43C718714eb63d5aA57B78B54704E256024E");
    expect(swapRoute(97, token, undefined)).toBeNull();
    expect(swapRoute(97, token, "0xA15BB66138824a1c7167f5E85b957d04Dd34E468")).toMatchObject({ pancake: false });
  });
});

describe("Atlas guard: fail closed", () => {
  const env: AtlasEnv = { ATLAS_RPC_URL: "http://127.0.0.1:1", ATLAS_FEED_USDT_USD: "0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b", ATLAS_FEED_BNB_USD: "0x3957d289ee9c38272377786787ea34f9dd29788d", ATLAS_API_KEY: "k" };
  const pull = (consensusStatus = "HEALTHY", body = fixture) =>
    vi.fn(async () => new Response(JSON.stringify({ data: { ...body.data, consensusScores: [{ ...body.data.consensusScores[0], consensusStatus }] } }), { status: 200 }));
  const feedClient = (updatedAt: number) => ({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => (functionName === "decimals" ? 18 : [BigInt(1), PRICE, BigInt(updatedAt), BigInt(updatedAt), BigInt(1)])),
  });
  const deps = (updatedAt: number, f: typeof fetch, signer: `0x${string}` | null = TEST_SIGNER) => ({
    now: () => NOW,
    fetch: f,
    signer: signer ?? undefined,
    readBnbUsd: (_: AtlasEnv, max: number) => readFeed(feedClient(updatedAt) as never, env.ATLAS_FEED_BNB_USD!, max, nowSec),
  });

  it("refuses a push feed older than 2x its heartbeat", async () => {
    const { status: s } = await loadAtlas(env, deps(nowSec - 121, pull() as never));
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/stale/);
    expect(s.maxAgeSec).toBe(120);
    // ...and the client re-checks the age against now (the status can be up to 30 s old).
    expect(planBnbSwap(BigInt(1), 6, status({ updatedAt: new Date(NOW - 121_000).toISOString() }), 97, NOW)).toEqual({ ok: false, why: "atlas" });
  });

  it("refuses when the Pull API consensus is CRITICAL (or SPLIT_MARKET, WARNING)", async () => {
    for (const c of ["CRITICAL", "SPLIT_MARKET", "WARNING"]) {
      const { status: s } = await loadAtlas(env, deps(nowSec - 30, pull(c) as never));
      expect(s).toMatchObject({ ok: false, consensus: { status: c } });
      expect(s.reason).toMatch(c);
      expect(planBnbSwap(BigInt(1), 6, s, 97, NOW).ok).toBe(false);
    }
  });

  it("refuses without a Pull API key or a verified report, and passes HEALTHY / DEGRADED from a fresh feed", async () => {
    const noKey = await loadAtlas({ ...env, ATLAS_API_KEY: "" }, deps(nowSec - 30, pull() as never));
    expect(noKey.status).toMatchObject({ ok: false, bnbUsd: 650 });
    expect(noKey.status.reason).toMatch(/consensus unknown/);
    // The fixture is not signed by Atlas's official key: the report is refused, so is the swap.
    const unsigned = await loadAtlas(env, deps(nowSec - 30, pull() as never, null));
    expect(unsigned.status.ok).toBe(false);
    expect(unsigned.status.reason).toMatch(/official Atlas signer/);
    expect(unsigned.proof).toBeNull();
    for (const c of ["HEALTHY", "DEGRADED"]) {
      const { status: s, proof } = await loadAtlas(env, deps(nowSec - 30, pull(c) as never));
      expect(s).toMatchObject({ ok: true, bnbUsdE18: PRICE.toString(), bnbUsd: 650, consensus: { score: 0.94, status: c }, maxAgeSec: 120 });
      expect(proof?.hash).toBe(keccak256(fixture.data.payload));
      expect(planBnbSwap(BigInt(1), 6, s, 97, NOW).ok).toBe(true);
    }
  });

  it("logs the Pull API call without the key", async () => {
    const f = pull();
    await loadAtlas(env, deps(nowSec - 30, f as never));
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ feedIds: [633, 649], signed: true });
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("k");
    const logs = await recentSponsorCalls("atlas");
    expect(logs.some((l) => l.endpoint === "POST /report/v1/price/latest")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('"k"');
  });
});

describe("Atlas push feeds as the display price source", () => {
  it("accepts a USDT/USD answer hours old (stablecoin feeds update rarely) but not a 1 h old BNB/USD one", async () => {
    const now = Math.floor(Date.now() / 1000);
    const ages: Record<string, number> = { "0x00000000000000000000000000000000000000aa": 24_319, "0x00000000000000000000000000000000000000bb": 60 };
    // A JSON-RPC node in place of fetch (tests/setup.ts blocks the network): decimals() and latestRoundData() per feed.
    const blocked = globalThis.fetch;
    globalThis.fetch = (async (_: unknown, init: RequestInit) => {
      const { id, params } = JSON.parse(String(init.body)) as { id: number; params: [{ to: string; data: string }] };
      const { to, data } = params[0];
      const result = data.startsWith("0x313ce567") // decimals()
        ? encodeAbiParameters([{ type: "uint8" }], [18])
        : encodeAbiParameters(["uint80", "int256", "uint256", "uint256", "uint80"].map((type) => ({ type })), [BigInt(1), to.endsWith("aa") ? BigInt(10) ** BigInt(18) : PRICE, BigInt(0), BigInt(now - ages[to]), BigInt(1)]);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const env = { ATLAS_RPC_URL: "http://127.0.0.1:1", ATLAS_FEED_USDT_USD: "0x00000000000000000000000000000000000000aa", ATLAS_FEED_BNB_USD: "0x00000000000000000000000000000000000000bb" };
    try {
      const q = await fetchAtlas(env, async () => 33);
      expect(q.rates.BNB).toEqual({ USD: 650, THB: 650 * 33 });
      ages["0x00000000000000000000000000000000000000bb"] = 3_601;
      await expect(fetchAtlas(env, async () => 33)).rejects.toThrow(/stale/);
    } finally {
      globalThis.fetch = blocked;
    }
  });
});

describe("Atlas signed report", () => {
  it("verifies against the signer and decodes the prices", async () => {
    const proof = await verifyAtlasReport(fixture.data, TEST_SIGNER);
    expect(proof.signer).toBe(TEST_SIGNER);
    expect(proof.hash).toBe(keccak256(fixture.data.payload));
    expect(proof.prices).toEqual([
      { feedId: 633, price: "553.07050073502693872", timestamp: 1795687760 },
      { feedId: 649, price: "0.998711560911491718", timestamp: 1795687760 },
    ]);
    // A payload without the trailing count byte hashes the same signed bytes.
    const noCount = await verifyAtlasReport({ ...fixture.data, payload: fixture.data.payload.slice(0, -2) }, TEST_SIGNER);
    expect(noCount.hash).toBe(proof.hash);
  });

  it("rejects a report not signed by the official Atlas signer, a tampered payload and a high-s signature", async () => {
    await expect(verifyAtlasReport(fixture.data)).rejects.toThrow(/not the official Atlas signer/);
    const tampered = fixture.data.payload.replace("1dfb", "1dfc");
    await expect(verifyAtlasReport({ ...fixture.data, payload: tampered }, TEST_SIGNER)).rejects.toThrow(/not the official/);
    const highS = `${fixture.data.signature.slice(0, 66)}${"f".repeat(64)}1b` as `0x${string}`;
    await expect(verifyAtlasReport({ ...fixture.data, signature: highS }, TEST_SIGNER)).rejects.toThrow(/malformed signature/);
    await expect(verifyAtlasReport({ ...fixture.data, payload: "0x0102" }, TEST_SIGNER)).rejects.toThrow(/malformed payload/);
  });

  it("is attached to, and hashed with, a settlement report that charges damage", async () => {
    const proof = await verifyAtlasReport(fixture.data, TEST_SIGNER);
    const photo = (b: string) => ({ hash: `0x${b.repeat(32)}` });
    const req = (checkOut: string) => ({ deposit: "100000000", decimals: 6, currency: "USDT", checkIn: [photo("11")], checkOut: [photo(checkOut)] }) as never;
    const priceProof = vi.fn(async () => proof);
    const now = new Date(NOW);
    // A return photo without a pickup twin: the demo inspector charges damage.
    const damaged = await proposeSettlement(req("22"), { priceProof, now });
    expect(BigInt(damaged.landlordClaim) > BigInt(0)).toBe(true);
    expect(damaged.priceProof).toEqual(proof);
    expect((await proposeSettlement(req("22"), { now })).reportHash).not.toBe(damaged.reportHash);
    // No damage, no price to prove.
    priceProof.mockClear();
    const clean = await proposeSettlement(req("11"), { priceProof, now });
    expect(clean.landlordClaim).toBe("0");
    expect(clean.priceProof).toBeUndefined();
    expect(priceProof).not.toHaveBeenCalled();
  });
});

describe("Atlas badge copy", () => {
  it("reads 'Priced by Atlas · updated N s ago · consensus 0.94 HEALTHY' in en and zh", () => {
    const b = atlasBadge(status());
    expect(b).toEqual({ age: 30, score: "0.94", status: "HEALTHY" });
    const line = (d: typeof en) => fmt(d.rental.money.atlas, { age: b.age! }) + fmt(d.rental.money.atlasConsensus, { score: b.score!, status: b.status! });
    expect(line(en)).toBe("Priced by Atlas · updated 30 s ago · consensus 0.94 HEALTHY");
    expect(line(zh as unknown as typeof en)).toBe("Atlas 定价 · 30 秒前更新 · 共识 0.94 HEALTHY");
    expect(atlasBadge(status({ consensus: undefined }))).toMatchObject({ score: null, status: null });
  });
});

// Keeps the fixture honest: it was signed by this throwaway key (see tests/fixtures/README.md).
it("fixture signer is the documented test key", () => {
  expect(privateKeyToAccount(keccak256(new TextEncoder().encode("keyscrow atlas test signer (fixture only)"))).address).toBe(TEST_SIGNER);
});
