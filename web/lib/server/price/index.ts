import { createPublicClient, http, isAddress, parseAbi, type Address } from "viem";

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

async function readFeed(client: ReturnType<typeof createPublicClient>, address: string) {
  if (!isAddress(address)) throw new Error(`invalid feed address ${address}`);
  const [decimals, round] = await Promise.all([
    client.readContract({ address: address as Address, abi: AGGREGATOR_ABI, functionName: "decimals" }),
    client.readContract({ address: address as Address, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }),
  ]);
  const answer = round[1];
  if (answer <= BigInt(0)) throw new Error(`feed ${address} returned a non-positive answer`);
  return { value: Number(answer) / 10 ** decimals, updatedAt: Number(round[3]) };
}

/** Reads USD prices from Atlas feeds. THB comes from an Atlas USD/THB feed or, failing that, `thbPerUsd`. */
export async function fetchAtlas(env: PriceEnv, thbPerUsd: () => Promise<number>): Promise<Omit<PriceQuote, "fetchedAt">> {
  const client = createPublicClient({ transport: http(env.ATLAS_RPC_URL, { timeout: 8_000 }) });
  const [usdt, bnb, thb] = await Promise.all([
    readFeed(client, env.ATLAS_FEED_USDT_USD!),
    readFeed(client, env.ATLAS_FEED_BNB_USD!),
    env.ATLAS_FEED_USD_THB ? readFeed(client, env.ATLAS_FEED_USD_THB) : null,
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

const CMC_QUOTES_URL = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest";

export function cmcKey(env: PriceEnv): string | undefined {
  return env.CMC_API_KEY || env.CMC_PRO_API_KEY || undefined;
}

interface CmcQuote {
  price: number;
  last_updated: string;
}
interface CmcResponse {
  status?: { error_code?: number; error_message?: string | null };
  data?: Record<string, Array<{ symbol: string; quote: Record<string, CmcQuote> }> | { symbol: string; quote: Record<string, CmcQuote> }>;
}

async function cmcQuotes(key: string, convert: Fiat, fetchImpl: FetchLike) {
  const url = `${CMC_QUOTES_URL}?symbol=USDT,BNB&convert=${convert}`;
  const res = await fetchImpl(url, {
    headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as CmcResponse;
  if (!res.ok || (body.status?.error_code ?? 0) !== 0) {
    throw new Error(`CoinMarketCap ${res.status}: ${body.status?.error_message ?? "request failed"}`);
  }
  const pick = (symbol: Asset): CmcQuote => {
    const entry = body.data?.[symbol];
    const first = Array.isArray(entry) ? entry[0] : entry;
    const q = first?.quote?.[convert];
    if (!q || typeof q.price !== "number" || !(q.price > 0)) throw new Error(`CoinMarketCap: no ${symbol}/${convert} quote`);
    return q;
  };
  return { USDT: pick("USDT"), BNB: pick("BNB") };
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
}

/** In-memory, per-process price cache with in-flight de-duplication and stale-on-error. */
export class PriceService {
  private cache: { quote: PriceQuote; expiresAt: number } | null = null;
  private inflight: Promise<PriceQuote> | null = null;
  private readonly env: PriceEnv;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly atlas: typeof fetchAtlas;
  readonly ttlMs: number;

  constructor(opts: PriceServiceOptions = {}) {
    this.env = opts.env ?? (process.env as PriceEnv);
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.atlas = opts.atlas ?? fetchAtlas;
    const ttl = Number(this.env.PRICE_CACHE_TTL_SECONDS);
    this.ttlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : 60) * 1000;
  }

  async get(): Promise<PriceQuote & { cached: boolean }> {
    const now = this.now().getTime();
    if (this.cache && now < this.cache.expiresAt) return { ...this.cache.quote, cached: true };
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return { ...(await this.inflight), cached: false };
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
}

let shared: PriceService | null = null;

/** Process-wide service used by the route handler. */
export function getPriceService(): PriceService {
  shared ??= new PriceService();
  return shared;
}
