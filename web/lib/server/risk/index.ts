import type { Env } from "../env";
import { onCloudflare } from "../platform";
import { cacheGet, cachePut, getSharedState, type SharedState } from "../state";
import { bufferedDeposit, computeBuffer, type CournotView, type RiskAsset, type RiskResponse } from "@/lib/risk";
import { cmcApiKey, cmcQuotes } from "../sponsors/cmc";
import { cournotConfig, depositClaim, storedResults } from "../sponsors/cournot";

type FetchLike = typeof fetch;
type Quotes = Extract<RiskResponse["cmc"], { ok: true }>["quotes"];

/**
 * Risk engine behind GET /api/risk: live CoinMarketCap quotes (USD for volatility, THB for display) set the
 * deposit buffer per payment token; the latest stored Cournot probability scales it. Without CMC_API_KEY it
 * reports "not configured" and computes nothing (no fake numbers).
 */
export class RiskService {
  private cache: { quotes: Quotes; fetchedAt: string; expiresAt: number } | null = null;
  private inflight: Promise<{ quotes: Quotes; fetchedAt: string }> | null = null;
  readonly ttlMs: number;

  constructor(
    private readonly env: Env = process.env,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
    /**
     * Cloudflare Workers: `shared` is the cross-isolate cache (the KeyEscrowState Durable Object) and `dedupe` is off,
     * since a promise one request's I/O resolves must not be awaited by another request there.
     */
    private readonly opts: { shared?: () => SharedState | null; dedupe?: boolean } = {},
  ) {
    const ttl = Number(env.RISK_CACHE_TTL_SECONDS);
    this.ttlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : 120) * 1000;
  }

  private async quotes(key: string): Promise<{ quotes: Quotes; fetchedAt: string; cached: boolean }> {
    const t = this.now().getTime();
    if (this.cache && t < this.cache.expiresAt) return { ...this.cache, cached: true };
    const state = this.opts.shared?.() ?? null;
    if (state) {
      const hit = await cacheGet<NonNullable<RiskService["cache"]>>(state, SHARED_KEY).catch(() => undefined);
      if (hit && t < hit.expiresAt) {
        this.cache = hit;
        return { ...hit, cached: true };
      }
    }
    const load = async () => {
      const [usd, thb] = await Promise.all([cmcQuotes(key, "USD", this.fetchImpl), cmcQuotes(key, "THB", this.fetchImpl)]);
      const one = (a: RiskAsset) => ({
        usd: usd[a].price,
        thb: thb[a].price,
        percentChange24h: usd[a].percent_change_24h ?? null,
        percentChange7d: usd[a].percent_change_7d ?? null,
        percentChange30d: usd[a].percent_change_30d ?? null,
        lastUpdated: usd[a].last_updated,
      });
      const fetchedAt = this.now().toISOString();
      const quotes = { USDT: one("USDT"), BNB: one("BNB") };
      this.cache = { quotes, fetchedAt, expiresAt: this.now().getTime() + this.ttlMs };
      if (state) await cachePut(state, SHARED_KEY, this.cache, this.ttlMs).catch((err) => console.warn("[risk] shared cache write failed", (err as Error).message));
      return { quotes, fetchedAt };
    };
    if (this.opts.dedupe === false) return { ...(await load()), cached: false };
    this.inflight ??= load().finally(() => {
      this.inflight = null;
    });
    return { ...(await this.inflight), cached: false };
  }

  async assess(depositThb: number, rentalDays: number): Promise<RiskResponse> {
    const latest = (await storedResults(this.env)).find((r) => /\bBNB\b/i.test(r.claim)) ?? null;
    let live: CournotView["live"] = "disabled";
    try {
      live = cournotConfig(this.env).live ? "enabled" : "disabled";
    } catch {
      live = "disabled";
    }
    const cournot: CournotView = { configured: true, live, claim: null, result: latest };
    const base = { rentalDays, depositThb, cournot };

    const key = cmcApiKey(this.env);
    if (!key) return { ...base, cmc: { configured: false, reason: "CMC_API_KEY is not set on the server (web/.env.local)." } };

    let q: Awaited<ReturnType<RiskService["quotes"]>>;
    try {
      q = await this.quotes(key);
    } catch (err) {
      if (!this.cache) {
        return { ...base, cmc: { configured: true, ok: false, error: (err as Error).message, fetchedAt: this.now().toISOString() } };
      }
      q = { quotes: this.cache.quotes, fetchedAt: this.cache.fetchedAt, cached: true };
    }

    const signal = latest ? { claim: latest.claim, probability: latest.probability, at: latest.at } : null;
    const options = {} as NonNullable<RiskResponse["options"]>;
    for (const a of ["USDT", "BNB"] as const) {
      const v = q.quotes[a];
      const b = computeBuffer(a, { price: v.usd, percentChange24h: v.percentChange24h, percentChange7d: v.percentChange7d, percentChange30d: v.percentChange30d }, rentalDays, a === "BNB" ? signal : null);
      const d = bufferedDeposit(depositThb, v.thb, b.buffer);
      options[a] = { ...b, depositThb: d.thb, depositTokens: d.tokens };
    }
    cournot.claim = depositClaim(options.BNB.coverageFloorUsd, new Date(this.now().getTime() + rentalDays * 86_400_000));
    return {
      ...base,
      cmc: { configured: true, ok: true, fetchedAt: q.fetchedAt, cached: q.cached, quotes: q.quotes },
      conversion: { amountThb: depositThb, usdt: depositThb / q.quotes.USDT.thb, bnb: depositThb / q.quotes.BNB.thb, lastUpdated: q.quotes.BNB.lastUpdated },
      options,
    };
  }
}

const SHARED_KEY = "risk:cmc-quotes";

let shared: RiskService | null = null;
export function getRiskService() {
  shared ??= onCloudflare() ? new RiskService(process.env, fetch, () => new Date(), { shared: getSharedState, dedupe: false }) : new RiskService();
  return shared;
}
