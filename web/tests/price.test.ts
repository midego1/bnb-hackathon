import { describe, expect, it, vi } from "vitest";
import { formatFiat, formatTokenInFiat, toFiat, type PriceResponse } from "@/lib/fiat";
import { fetchCmc, MOCK_RATES, PriceService } from "@/lib/server/price";

function clock(start = Date.parse("2026-11-25T00:00:00Z")) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

function cmcFetch(prices: { USD: [number, number]; THB: [number, number] }) {
  return vi.fn(async (url: string | URL | Request) => {
    const convert = new URL(String(url)).searchParams.get("convert") as "USD" | "THB";
    const [usdt, bnb] = prices[convert];
    const q = (price: number) => ({ quote: { [convert]: { price, last_updated: "2026-11-24T23:59:00.000Z" } } });
    return new Response(
      JSON.stringify({ status: { error_code: 0 }, data: { USDT: [{ symbol: "USDT", ...q(usdt) }], BNB: [{ symbol: "BNB", ...q(bnb) }] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("PriceService", () => {
  it("returns marked mock rates with a timestamp when nothing is configured", async () => {
    const c = clock();
    const svc = new PriceService({ env: {}, now: c.now });
    const q = await svc.get();
    expect(q.mock).toBe(true);
    expect(q.source).toBe("mock");
    expect(q.rates).toEqual(MOCK_RATES);
    expect(q.updatedAt).toBe("2026-11-25T00:00:00.000Z");
    expect(q.warning).toBeUndefined();
  });

  it("uses CoinMarketCap with a key and caches for the TTL", async () => {
    const c = clock();
    const f = cmcFetch({ USD: [1.0002, 640], THB: [33.1, 21184] });
    const svc = new PriceService({ env: { CMC_API_KEY: "k" }, fetch: f, now: c.now });
    const q = await svc.get();
    expect(q).toMatchObject({ source: "cmc", mock: false, cached: false });
    expect(q.rates.BNB).toEqual({ USD: 640, THB: 21184 });
    expect(f).toHaveBeenCalledTimes(2);
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-CMC_PRO_API_KEY"]).toBe("k");

    c.advance(30_000);
    expect((await svc.get()).cached).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);

    c.advance(31_000);
    await svc.get();
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("de-duplicates concurrent loads", async () => {
    const f = cmcFetch({ USD: [1, 600], THB: [33, 19800] });
    const svc = new PriceService({ env: { CMC_PRO_API_KEY: "k" }, fetch: f });
    await Promise.all([svc.get(), svc.get(), svc.get()]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("serves stale live data when CMC later fails, mock with a warning when it never worked", async () => {
    const c = clock();
    let fail = false;
    const ok = cmcFetch({ USD: [1, 600], THB: [33, 19800] });
    const f = vi.fn(async (u: string) => (fail ? new Response("{}", { status: 500 }) : ok(u))) as unknown as typeof fetch;
    const svc = new PriceService({ env: { CMC_API_KEY: "k" }, fetch: f, now: c.now });
    await svc.get();
    fail = true;
    c.advance(61_000);
    const stale = await svc.get();
    expect(stale.source).toBe("cmc");
    expect(stale.warning).toMatch(/cmc/);

    const bad = new PriceService({ env: { CMC_API_KEY: "k" }, fetch: vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch });
    const m = await bad.get();
    expect(m.mock).toBe(true);
    expect(m.warning).toMatch(/CoinMarketCap 401/);
  });

  it("prefers Atlas when configured", async () => {
    const atlas = vi.fn(async () => ({
      rates: { USDT: { USD: 1, THB: 33.2 }, BNB: { USD: 655, THB: 21746 } },
      source: "atlas" as const,
      mock: false,
      updatedAt: "2026-11-24T23:58:00.000Z",
    }));
    const f = cmcFetch({ USD: [1, 600], THB: [33, 19800] });
    const env = { ATLAS_RPC_URL: "http://127.0.0.1:1", ATLAS_FEED_USDT_USD: "0x1", ATLAS_FEED_BNB_USD: "0x2", CMC_API_KEY: "k" };
    const q = await new PriceService({ env, atlas, fetch: f }).get();
    expect(q.source).toBe("atlas");
    expect(atlas).toHaveBeenCalledOnce();
    expect(f).not.toHaveBeenCalled();
  });

  it("falls back from a failing Atlas to CMC", async () => {
    const atlas = vi.fn(async () => {
      throw new Error("rpc down");
    });
    const f = cmcFetch({ USD: [1, 600], THB: [33, 19800] });
    const env = { ATLAS_RPC_URL: "http://127.0.0.1:1", ATLAS_FEED_USDT_USD: "0x1", ATLAS_FEED_BNB_USD: "0x2", CMC_API_KEY: "k" };
    const q = await new PriceService({ env, atlas, fetch: f }).get();
    expect(q.source).toBe("cmc");
  });

  it("fetchCmc rejects malformed responses", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: { error_code: 0 }, data: {} }))) as unknown as typeof fetch;
    await expect(fetchCmc("k", f)).rejects.toThrow(/no USDT/);
  });
});

describe("fiat formatting", () => {
  const prices: PriceResponse = {
    rates: MOCK_RATES,
    source: "mock",
    mock: true,
    updatedAt: "2026-11-25T00:00:00.000Z",
    fetchedAt: "2026-11-25T00:00:00.000Z",
  };

  it("converts base units and human amounts", () => {
    expect(toFiat(BigInt(500_000_000), "USDT", "THB", prices)).toBe(16500);
    expect(toFiat("2.5", "USDT", "USD", prices)).toBe(2.5);
    expect(toFiat(BigInt(10) ** BigInt(18), "BNB", "USD", prices)).toBe(650);
    expect(toFiat(1, "USDT", "USD", undefined)).toBeNull();
  });

  it("formats THB and USD", () => {
    expect(formatFiat(16500, "THB")).toBe("฿16,500");
    expect(formatFiat(12.5, "THB")).toBe("฿12.50");
    expect(formatFiat(500, "USD")).toBe("$500.00");
    expect(formatTokenInFiat(BigInt(500_000_000), "USDT", prices)).toBe("฿16,500 · $500.00");
    expect(formatTokenInFiat(BigInt(1), "USDT", null)).toBe("");
  });
});
