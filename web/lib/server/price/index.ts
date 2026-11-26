import { createPublicClient, http, isAddress, parseAbi, type Address } from "viem";
import { onCloudflare } from "../platform";
import { cmcQuotes } from "../sponsors/cmc";
import { logSponsorCall } from "../sponsors/log";
import { cacheGet, cachePut, getSharedState, type SharedState } from "../state";

export type Fiat = "USD" | "THB";
export type Asset = "USDT" | "BNB";
export type PriceSource = "atlas" | "cmc" | "mock";

export interface PriceQuote {
  /** Fiat price of one unit of each asset. */
  rates: Record<Asset, Record<Fiat, number>>;
  source: PriceSource;
  mock: boolean;
  /** When the upstream data was observed (ISO 8601). */
  updatedAt: string;
  /** When this server fetched it; responses within the cache TTL reuse it. */
  fetchedAt: string;
  /** Set when a live source failed and the result is stale cache or mock. */
  warning?: string;
}

/**
 * Static demo rates. Clearly marked `mock: true` in responses; never shown as live data.
 * Rough late-2026 levels; they only need to be plausible for a demo.
 */
export const MOCK_RATES: PriceQuote["rates"] = {
  USDT: { USD: 1, THB: 33 },
  BNB: { USD: 650, THB: 21450 },
};

type FetchLike = typeof fetch;

export interface PriceEnv {
  CMC_API_KEY?: string;
  CMC_PRO_API_KEY?: string;
  ATLAS_RPC_URL?: string;
  ATLAS_FEED_USDT_USD?: string;
  ATLAS_FEED_BNB_USD?: string;
  ATLAS_FEED_USD_THB?: string;
  ATLAS_MAX_AGE_SECONDS?: string;
  PRICE_CACHE_TTL_SECONDS?: string;
}

// ---------------------------------------------------------------------------------------------
// Atlas on-chain feeds (AggregatorV3-compatible: decimals() + latestRoundData())
// ---------------------------------------------------------------------------------------------

const AGGREGATOR_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export function atlasConfigured(env: PriceEnv): boolean {
  return Boolean(env.ATLAS_RPC_URL && env.ATLAS_FEED_USDT_USD && env.ATLAS_FEED_BNB_USD);
}

/** Atlas's USDT/USD feed has a 24 h heartbeat (BNB/USD: 60 s), so a 1 h limit would reject it between heartbeats. */
const USDT_FEED_MAX_AGE_SECONDS = 25 * 3600;

/** Max age of an Atlas answer before it is rejected (Atlas docs: "always check staleness"). Default 1 h; USDT at least 25 h. */
export function atlasMaxAgeSeconds(env: PriceEnv, asset?: Asset): number {
  const v = Number(env.ATLAS_MAX_AGE_SECONDS);
  const max = Number.isFinite(v) && v > 0 ? v : 3600;
  return asset === "USDT" ? Math.max(max, USDT_FEED_MAX_AGE_SECONDS) : max;
}

export class StalePriceError extends Error {}

/** latestRoundData() with the Atlas staleness check: never-updated, non-positive and stale answers are rejected. */
export async function readFeed(client: Pick<ReturnType<typeof createPublicClient>, "readContract">, address: string, maxAgeSeconds = 3600, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!isAddress(address)) throw new Error(`invalid feed address ${address}`);
  const started = Date.now();
  try {
    const [decimals, round] = await Promise.all([
      client.readContract({ address: address as Address, abi: AGGREGATOR_ABI, functionName: "decimals" }),
      client.readContract({ address: address as Address, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }),
    ]);
    const answer = round[1];
    const updatedAt = Number(round[3]);
    if (answer === BigInt(0) || updatedAt === 0) throw new StalePriceError(`feed ${address} was never updated`);
    if (answer < BigInt(0)) throw new Error(`feed ${address} returned a non-positive answer`);
    const age = nowSeconds - updatedAt;
    if (age > maxAgeSeconds) throw new StalePriceError(`feed ${address} is stale: updated ${age}s ago (max ${maxAgeSeconds}s)`);
    await logSponsorCall({ sponsor: "atlas", endpoint: `eth_call latestRoundData() ${address}`, at: new Date(started).toISOString(), status: 200, ok: true, ms: Date.now() - started, note: `age=${age}s` });
    return { value: Number(answer) / 10 ** decimals, updatedAt, answer, decimals };
  } catch (err) {
    await logSponsorCall({ sponsor: "atlas", endpoint: `eth_call latestRoundData() ${address}`, at: new Date(started).toISOString(), status: null, ok: false, ms: Date.now() - started, note: (err as Error).message.slice(0, 160) });
    throw err;
  }
}

/** Reads USD prices from Atlas feeds. THB comes from an Atlas USD/THB feed or, failing that, `thbPerUsd`. */
export async function fetchAtlas(env: PriceEnv, thbPerUsd: () => Promise<number>): Promise<Omit<PriceQuote, "fetchedAt">> {
  const client = createPublicClient({ transport: http(env.ATLAS_RPC_URL, { timeout: 8_000 }) });
  const maxAge = atlasMaxAgeSeconds(env);
  const [usdt, bnb, thb] = await Promise.all([
    readFeed(client, env.ATLAS_FEED_USDT_USD!, atlasMaxAgeSeconds(env, "USDT")),
    readFeed(client, env.ATLAS_FEED_BNB_USD!, maxAge),
    env.ATLAS_FEED_USD_THB ? readFeed(client, env.ATLAS_FEED_USD_THB, maxAge) : null,
  ]);
  const fx = thb?.value ?? (await thbPerUsd());
  const updated = Math.min(usdt.updatedAt, bnb.updatedAt, thb?.updatedAt ?? Infinity);
  return {
    rates: {
      USDT: { USD: usdt.value, THB: usdt.value * fx },
      BNB: { USD: bnb.value, THB: bnb.value * fx },
    },
    source: "atlas",
    mock: false,
    updatedAt: new Date(updated * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// CoinMarketCap Pro API (server-side key only)
// ---------------------------------------------------------------------------------------------

export function cmcKey(env: PriceEnv): string | undefined {
  return env.CMC_API_KEY || env.CMC_PRO_API_KEY || undefined;
}

/**
 * Two calls (convert=USD, convert=THB): the free Basic plan allows one convert currency per call.
 * Each call costs 1 credit, so the in-memory cache TTL bounds credit use.
 */
export async function fetchCmc(key: string, fetchImpl: FetchLike = fetch): Promise<Omit<PriceQuote, "fetchedAt">> {
  const [usd, thb] = await Promise.all([cmcQuotes(key, "USD", fetchImpl), cmcQuotes(key, "THB", fetchImpl)]);
  const updated = [usd.USDT, usd.BNB, thb.USDT, thb.BNB].map((q) => Date.parse(q.last_updated)).filter(Number.isFinite);
  return {
    rates: {
      USDT: { USD: usd.USDT.price, THB: thb.USDT.price },
      BNB: { USD: usd.BNB.price, THB: thb.BNB.price },
    },
    source: "cmc",
    mock: false,
    updatedAt: new Date(updated.length ? Math.min(...updated) : Date.now()).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Source selection + cache
// ---------------------------------------------------------------------------------------------

export function mockQuote(now: Date, warning?: string): PriceQuote {
  const ts = now.toISOString();
  return { rates: MOCK_RATES, source: "mock", mock: true, updatedAt: ts, fetchedAt: ts, ...(warning ? { warning } : {}) };
}

export interface PriceServiceOptions {
  env?: PriceEnv;
  fetch?: FetchLike;
  now?: () => Date;
  /** Override the Atlas reader (tests). */
  atlas?: typeof fetchAtlas;
  /**
   * Cross-isolate cache behind the in-memory one (the KeyEscrowState Durable Object on Cloudflare Workers, where
   * process memory is per isolate). Called per request; null/undefined -> in-memory only.
   */
  shared?: () => SharedState | null;
  /**
   * Share one in-flight upstream fetch between concurrent requests (default true). Off on Workers: a promise that one
   * request's I/O resolves must not be awaited by another request there.
   */
  dedupe?: boolean;
}

const SHARED_KEY = "price:quote";

/** In-memory, per-process price cache with in-flight de-duplication and stale-on-error (plus an optional shared cache). */
export class PriceService {
  private cache: { quote: PriceQuote; expiresAt: number } | null = null;
  private inflight: Promise<PriceQuote> | null = null;
  private readonly env: PriceEnv;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly atlas: typeof fetchAtlas;
  private readonly shared: () => SharedState | null;
  private readonly dedupe: boolean;
  readonly ttlMs: number;

  constructor(opts: PriceServiceOptions = {}) {
    this.env = opts.env ?? (process.env as PriceEnv);
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.atlas = opts.atlas ?? fetchAtlas;
    this.shared = opts.shared ?? (() => null);
    this.dedupe = opts.dedupe ?? true;
    const ttl = Number(this.env.PRICE_CACHE_TTL_SECONDS);
    this.ttlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : 60) * 1000;
  }

  async get(): Promise<PriceQuote & { cached: boolean }> {
    const now = this.now().getTime();
    if (this.cache && now < this.cache.expiresAt) return { ...this.cache.quote, cached: true };
    const fromShared = await this.readShared(now);
    if (fromShared) return { ...fromShared, cached: true };
    if (!this.dedupe) return { ...(await this.loadAndShare()), cached: false };
    this.inflight ??= this.loadAndShare().finally(() => {
      this.inflight = null;
    });
    return { ...(await this.inflight), cached: false };
  }

  private async loadAndShare(): Promise<PriceQuote> {
    const quote = await this.load();
    // Fresh live quotes only: a mock answer or a stale fallback must not pin every isolate for a whole TTL.
    if (!quote.mock && !quote.warning && this.cache) await this.writeShared(this.cache);
    return quote;
  }

  private async load(): Promise<PriceQuote> {
    const errors: string[] = [];
    const fetchedAt = this.now().toISOString();
    const key = cmcKey(this.env);

    if (atlasConfigured(this.env)) {
      try {
        const thbPerUsd = async () => {
          // No Atlas USD/THB feed: derive the FX rate from CMC's USDT quotes, else the static rate.
          if (!key) return MOCK_RATES.USDT.THB / MOCK_RATES.USDT.USD;
          const { rates } = await fetchCmc(key, this.fetchImpl);
          return rates.USDT.THB / rates.USDT.USD;
        };
        return this.store({ ...(await this.atlas(this.env, thbPerUsd)), fetchedAt });
      } catch (err) {
        errors.push(`atlas: ${(err as Error).message}`);
      }
    }
    if (key) {
      try {
        return this.store({ ...(await fetchCmc(key, this.fetchImpl)), fetchedAt });
      } catch (err) {
        errors.push(`cmc: ${(err as Error).message}`);
      }
    }

    const warning = errors.length ? `live price sources failed (${errors.join("; ")})` : undefined;
    // Prefer slightly stale live data over mock data when an upstream hiccups.
    if (this.cache && !this.cache.quote.mock) {
      this.cache.expiresAt = this.now().getTime() + this.ttlMs;
      return { ...this.cache.quote, warning };
    }
    return this.store(mockQuote(this.now(), warning));
  }

  private store(quote: PriceQuote): PriceQuote {
    this.cache = { quote, expiresAt: this.now().getTime() + this.ttlMs };
    return quote;
  }

  /** A live quote another isolate fetched within the TTL; it also refills the in-memory cache. */
  private async readShared(now: number): Promise<PriceQuote | null> {
    const state = this.shared();
    if (!state) return null;
    try {
      const hit = await cacheGet<{ quote: PriceQuote; expiresAt: number }>(state, SHARED_KEY);
      if (!hit || now >= hit.expiresAt) return null;
      this.cache = hit;
      return hit.quote;
    } catch (err) {
      console.warn("[price] shared cache read failed", (err as Error).message);
      return null;
    }
  }

  private async writeShared(entry: { quote: PriceQuote; expiresAt: number }) {
    const state = this.shared();
    if (!state) return;
    try {
      await cachePut(state, SHARED_KEY, entry, Math.max(1, entry.expiresAt - this.now().getTime()));
    } catch (err) {
      console.warn("[price] shared cache write failed", (err as Error).message);
    }
  }
}

let shared: PriceService | null = null;

/** Process-wide service used by the route handler; on Cloudflare Workers it also shares quotes across isolates. */
export function getPriceService(): PriceService {
  shared ??= new PriceService(onCloudflare() ? { shared: getSharedState, dedupe: false } : {});
  return shared;
}
