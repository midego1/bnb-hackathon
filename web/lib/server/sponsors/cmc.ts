import type { Env } from "../env";
import type { RiskAsset } from "@/lib/risk";
import { logSponsorCall, safeEndpoint } from "./log";

/** CoinMarketCap Pro API, server-side only. The key never leaves this module and is never logged. */
export const CMC_BASE = "https://pro-api.coinmarketcap.com";

/** CMC_API_BASE may only point at the real API or a local fixture server (Playwright replays recorded fixtures). */
export function cmcBase(env: Env = process.env): string {
  const b = (env.CMC_API_BASE || CMC_BASE).replace(/\/+$/, "");
  if (b === CMC_BASE || /^http:\/\/127\.0\.0\.1:\d+$/.test(b)) return b;
  throw new CmcError(`CMC_API_BASE must be ${CMC_BASE} or http://127.0.0.1:<port>`, null);
}

type FetchLike = typeof fetch;

export function cmcApiKey(env: Env = process.env): string | undefined {
  return env.CMC_API_KEY || env.CMC_PRO_API_KEY || undefined;
}

export class CmcError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

interface CmcEnvelope<T> {
  status?: { error_code?: number; error_message?: string | null; credit_count?: number; timestamp?: string };
  data?: T;
}

/** GET a Pro API path; logs endpoint, time, status and credit count (never the key). */
export async function cmcGet<T>(pathname: string, params: Record<string, string>, key: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const url = new URL(pathname, cmcBase());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const started = Date.now();
  const at = new Date(started).toISOString();
  let status: number | null = null;
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    status = res.status;
    const body = (await res.json().catch(() => ({}))) as CmcEnvelope<T>;
    const ok = res.ok && (body.status?.error_code ?? 0) === 0;
    await logSponsorCall({
      sponsor: "cmc",
      endpoint: safeEndpoint("GET", url),
      at,
      status,
      ok,
      ms: Date.now() - started,
      note: ok ? `credits=${body.status?.credit_count ?? "?"}` : (body.status?.error_message ?? "request failed").slice(0, 160),
    });
    if (!ok || body.data === undefined) throw new CmcError(`CoinMarketCap ${res.status}: ${body.status?.error_message ?? "request failed"}`, status);
    return body.data;
  } catch (err) {
    if (err instanceof CmcError) throw err;
    await logSponsorCall({ sponsor: "cmc", endpoint: safeEndpoint("GET", url), at, status, ok: false, ms: Date.now() - started, note: (err as Error).message.slice(0, 160) });
    throw new CmcError(`CoinMarketCap request failed: ${(err as Error).message}`, status);
  }
}

interface CmcQuoteFields {
  price: number;
  percent_change_1h?: number | null;
  percent_change_24h?: number | null;
  percent_change_7d?: number | null;
  percent_change_30d?: number | null;
  last_updated: string;
}
type CmcQuotesData = Record<string, Array<{ symbol: string; quote: Record<string, CmcQuoteFields> }> | { symbol: string; quote: Record<string, CmcQuoteFields> }>;

/** `/v2/cryptocurrency/quotes/latest` for USDT + BNB in one fiat (the Basic plan allows one convert per call). */
export async function cmcQuotes(key: string, convert: "USD" | "THB", fetchImpl: FetchLike = fetch): Promise<Record<RiskAsset, CmcQuoteFields>> {
  const data = await cmcGet<CmcQuotesData>("/v2/cryptocurrency/quotes/latest", { symbol: "USDT,BNB", convert }, key, fetchImpl);
  const pick = (symbol: RiskAsset): CmcQuoteFields => {
    const entry = data[symbol];
    const first = Array.isArray(entry) ? entry[0] : entry;
    const q = first?.quote?.[convert];
    if (!q || typeof q.price !== "number" || !(q.price > 0)) throw new CmcError(`CoinMarketCap: no ${symbol}/${convert} quote`, 200);
    return q;
  };
  return { USDT: pick("USDT"), BNB: pick("BNB") };
}
