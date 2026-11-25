import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env";
import type { CournotStoredResult } from "@/lib/risk";
import committedResults from "@/data/cournot-results.json";
import { onCloudflare } from "../platform";
import { getSharedState, update } from "../state";
import { logSponsorCall, sponsorLogDir } from "./log";

/**
 * Cournot Intelligence Oracle (https://github.com/Cournot-AI/cournot-skills), called the same way its
 * official client does: POST /intelligence/v1/resolve (free) to find the reference market, then
 * POST /intelligence/v1/probability. Probability calls are 3 free per IP for life, then paid (x402/b402),
 * so live calls are OFF unless COURNOT_LIVE=1 and every answer is stored and reused. Never called in tests.
 */

export const COURNOT_DEFAULT_BASE = "https://interface.cournot.ai";
const ALLOWED_BASES = new Set(["https://interface.cournot.ai", "https://dev-interface.cournot.ai"]);

type FetchLike = typeof fetch;

export interface CournotConfig {
  base: string;
  apiKey?: string;
  live: boolean;
}

export function cournotConfig(env: Env = process.env): CournotConfig {
  const base = (env.COURNOT_API_BASE || COURNOT_DEFAULT_BASE).replace(/\/+$/, "");
  if (!ALLOWED_BASES.has(base) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error(`COURNOT_API_BASE must be one of ${[...ALLOWED_BASES].join(", ")}`);
  const apiKey = env.COURNOT_API_KEY && /^ck_live_[A-Za-z0-9_-]{1,256}$/.test(env.COURNOT_API_KEY) ? env.COURNOT_API_KEY : undefined;
  return { base, apiKey, live: env.COURNOT_LIVE === "1" && !env.VITEST };
}

export class CournotError extends Error {
  constructor(
    message: string,
    readonly state: "payment_required" | "rate_limited" | "service_error" | "no_market" | "api_error" | "disabled",
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

interface Envelope {
  code?: number;
  msg?: string;
  data?: Record<string, unknown>;
}

async function post(cfg: CournotConfig, p: "resolve" | "probability", body: unknown, fetchImpl: FetchLike) {
  const url = `${cfg.base}/intelligence/v1/${p}`;
  const started = Date.now();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers["COURNOT-API-KEY"] = cfg.apiKey;
  let status: number | null = null;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(p === "probability" ? 120_000 : 30_000),
      cache: "no-store",
    });
    status = res.status;
    const text = await res.text();
    const parsed = (text.trim() ? JSON.parse(text) : {}) as Envelope;
    const requestId = res.headers.get("x-request-id") || res.headers.get("request-id") || res.headers.get("x-trace-id") || null;
    const ok = res.ok && parsed.code === 0;
    await logSponsorCall({
      sponsor: "cournot",
      endpoint: `POST /intelligence/v1/${p}`,
      at: new Date(started).toISOString(),
      status,
      ok,
      ms: Date.now() - started,
      note: ok ? (requestId ? `request-id=${requestId}` : undefined) : `code=${parsed.code ?? "?"} ${String(parsed.msg ?? "").slice(0, 120)}`,
    });
    if (res.status === 402) throw new CournotError("Cournot free calls used up for this IP: a paid call (x402/b402 wallet) or a prepaid key is needed.", "payment_required", 402);
    if (res.status === 429) throw new CournotError("Cournot rate limit", "rate_limited", 429);
    if (res.status >= 500) throw new CournotError(`Cournot service error ${res.status}`, "service_error", res.status);
    if (!ok) throw new CournotError(`Cournot ${p} failed: code ${parsed.code} ${parsed.msg ?? ""}`.trim(), "api_error", res.status);
    return { data: parsed.data ?? {}, requestId };
  } catch (err) {
    if (err instanceof CournotError) throw err;
    await logSponsorCall({ sponsor: "cournot", endpoint: `POST /intelligence/v1/${p}`, at: new Date(started).toISOString(), status, ok: false, ms: Date.now() - started, note: (err as Error).message.slice(0, 160) });
    throw new CournotError(`Cournot ${p} request failed: ${(err as Error).message}`, "service_error", status);
  }
}

interface ResolvedMarket {
  matching_confidence?: number;
  market_info?: { id?: string | number; title?: string; end_time?: string };
}

/** Reads `probability` per the skill's response-format reference (nested object or plain number). */
export function readProbability(data: Record<string, unknown>): { probability: number; result: Record<string, unknown> | null; basis: unknown } {
  const nested = data.probability && typeof data.probability === "object" ? (data.probability as Record<string, unknown>) : null;
  const result = ((nested?.result ?? data.result) as Record<string, unknown> | undefined) ?? null;
  const basis = nested?.basis ?? data.basis ?? null;
  const candidates = [result?.point_estimate, result?.probability, typeof data.probability === "number" ? data.probability : undefined, nested?.point_estimate];
  const probability = candidates.map(Number).find((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  if (probability === undefined) throw new CournotError("Cournot response has no probability", "api_error", 200);
  return { probability, result, basis };
}

/** One live evaluation: resolve (free) + probability (counts against the 3 free calls / IP). */
export async function evaluateClaim(claim: string, cfg: CournotConfig, fetchImpl: FetchLike = fetch): Promise<CournotStoredResult> {
  if (!cfg.live) throw new CournotError("Live Cournot calls are disabled (set COURNOT_LIVE=1).", "disabled");
  const resolved = await post(cfg, "resolve", { message: claim, limit: 3 }, fetchImpl);
  const markets = ((resolved.data.markets as ResolvedMarket[] | undefined) ?? []).filter((m) => m.market_info?.id !== undefined);
  markets.sort((a, b) => (b.matching_confidence ?? 0) - (a.matching_confidence ?? 0));
  const best = markets[0];
  if (!best) throw new CournotError("Cournot found no reference market for this claim", "no_market");
  const marketId = String(best.market_info!.id);
  const prob = await post(cfg, "probability", { message: claim, market_ids: [marketId] }, fetchImpl);
  const { probability, result, basis } = readProbability(prob.data);
  const billing = prob.data.billing ?? null;
  const freeQuota = prob.data.free_quota && typeof prob.data.free_quota === "object" ? { ...(prob.data.free_quota as Record<string, unknown>) } : null;
  if (freeQuota) delete freeQuota.ip; // never store the caller's IP
  return {
    claim,
    marketId,
    marketTitle: best.market_info?.title ?? null,
    probability,
    result,
    basis,
    billing: { billing, free_quota: freeQuota, charged: prob.data.charged ?? null },
    at: new Date().toISOString(),
    requestId: prob.requestId ?? `keyescrow-${randomUUID()}`,
    source: "live",
  };
}

// ---------------------------------------------------------------------------------------------
// Result store: every live answer is kept and reused (no repeat calls for the same claim).
// Runtime answers: web/.sponsor-logs/cournot-results.json (gitignored).
// Committed answers from real calls (proof for judges): web/data/cournot-results.json.
// ---------------------------------------------------------------------------------------------

export function committedResultsFile() {
  return path.join(process.cwd(), "data", "cournot-results.json");
}
function runtimeResultsFile(env: Env) {
  return path.join(sponsorLogDir(env), "cournot-results.json");
}

async function readJson(file: string): Promise<CournotStoredResult[]> {
  try {
    const v = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** On Cloudflare Workers (no disk) runtime answers live in the KeyEscrowState Durable Object, newest 100 kept. */
const SHARED_RESULTS = "cournot:results";

export async function storedResults(env: Env = process.env): Promise<CournotStoredResult[]> {
  const all = onCloudflare()
    ? // The committed answers are bundled into the Worker; runtime ones come from the Durable Object.
      [...(committedResults as CournotStoredResult[]), ...((await getSharedState().get<CournotStoredResult[]>(SHARED_RESULTS))?.value ?? [])]
    : [...(await readJson(committedResultsFile())), ...(await readJson(runtimeResultsFile(env)))];
  return all.filter((r) => typeof r?.probability === "number" && typeof r.claim === "string").sort((a, b) => b.at.localeCompare(a.at));
}

export async function saveResult(r: CournotStoredResult, env: Env = process.env) {
  if (onCloudflare()) {
    await update<CournotStoredResult[], void>(getSharedState(), SHARED_RESULTS, (cur) => ({ value: [...(cur ?? []), r].slice(-100), result: undefined }));
    return;
  }
  const file = runtimeResultsFile(env);
  const list = await readJson(file);
  list.push(r);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2));
  await rename(tmp, file);
}

/** "Will BNB fall below $512 at any time before 2026-12-25 00:00 UTC?" (asset, threshold, date). */
export function depositClaim(floorUsd: number, returnDate: Date): string {
  // Round to $10 and to the day so nearby deposits share one claim (and one stored answer).
  const d = returnDate.toISOString().slice(0, 10);
  return `Will BNB fall below $${Math.round(floorUsd / 10) * 10} at any time before ${d} 00:00 UTC?`;
}
