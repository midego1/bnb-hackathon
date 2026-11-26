import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { defaultChainId } from "@/lib/actions/context";
import { getEvidenceStore } from "@/lib/server/evidence";
import { recordAiClaim } from "@/lib/server/history";
import { clientIp, jsonError, zodIssues } from "@/lib/server/http";
import { cloudflareBinding } from "@/lib/server/platform";
import { inspectionMemoryFromEnv } from "@/lib/server/sponsors/livingbrain";
import { getSharedState, hitRateLimit } from "@/lib/server/state";
import { inspectorFromEnv, proposeSettlement, visionProviderFromEnv, type PhotoSource } from "@/lib/server/settlement";
import { leaseMemoryKey, SettlementRouteRequestSchema } from "@/lib/server/settlement/lease";

/**
 * POST /api/settlement — AI return inspection.
 * Body: { deposit, decimals?, currency?, checkIn: Photo[], checkOut: Photo[], notes?, scooterId?, lease?, chainId? }
 * Before judging, the inspector reads the scooter's inspection memory (Living Brain, or local). Only an inspection of
 * a `lease` this deployment's factory created (checked on-chain) is written back, under that rental's scooter
 * (settlement/lease.ts), and its proposal is recorded for the dispute desk's claim-vs-AI fact (lib/server/history); a
 * bare scooterId is read-only.
 * Returns a proposal whose tenantRefund + landlordClaim always equals the deposit.
 * Rate limits per caller IP: 10 live-model inspections an hour (each is a paid model call), and 20 memory writes an
 * hour (over it the inspection still runs, read-only). Server-wide: SETTLEMENT_DAILY_CALLS live-model inspections per
 * 24 hours (default 300); over it, and whenever the model is busy or cannot see the photos, the demo inspector
 * answers and the report says so (`fallback`).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = SettlementRouteRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid settlement request", zodIssues(parsed.error));

  try {
    const provider = visionProviderFromEnv();
    let overDailyCap = false;
    if (provider) {
      const rate = await hitRateLimit(getSharedState(), `settlement:${clientIp(request)}`, { limit: 10, windowMs: 3_600_000 });
      if (!rate.ok) return jsonError(429, `Too many AI inspections from this address. Try again in about ${Math.ceil(rate.retryAfterSec / 60)} min.`);
      // After the per-IP check, so one address over its limit does not use up everyone's daily calls.
      overDailyCap = !(await hitRateLimit(getSharedState(), "settlement:all", { limit: dailyCalls(), windowMs: 86_400_000 })).ok;
    }
    const { lease, chainId, ...req } = parsed.data;
    const verified = lease ? await rememberAs(clientIp(request), lease, chainId) : null;
    const result = await proposeSettlement(req, {
      provider,
      fallback: overDailyCap ? "limit" : undefined,
      store: getEvidenceStore(),
      photoSource: photoSource(request),
      inspector: inspectorFromEnv(),
      memory: inspectionMemoryFromEnv(),
      rememberAs: verified,
    });
    // The AI's proposal for this verified rental, so the dispute desk can compare it with the owner's claim.
    if (verified) {
      const claim = { reportHash: result.reportHash, landlordClaim: result.landlordClaim, deposit: result.deposit, mock: result.mock, at: result.createdAt };
      await recordAiClaim(chainId ?? defaultChainId(process.env), verified.rental, claim).catch((err: Error) => console.warn("settlement: AI claim not recorded", err.message));
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("settlement failed", (err as Error).name, (err as Error).message);
    return jsonError(502, "settlement provider failed");
  }
}

/** Server-wide live-model inspections per 24 hours: SETTLEMENT_DAILY_CALLS, default 300. */
function dailyCalls() {
  const n = Number(process.env.SETTLEMENT_DAILY_CALLS);
  return Number.isInteger(n) && n > 0 ? n : 300;
}

/**
 * Photo urls on the host the caller used (the /demo walkthrough photos) are this app's static files: on Workers from
 * the ASSETS binding (a fetch to the own workers.dev host is not allowed), under Node from public/ on disk. Never a
 * network fetch, so trusting the caller's Host header here is safe. (request.url is not: on a Worker OpenNext may
 * report another host, e.g. localhost under wrangler dev.)
 */
function photoSource(request: NextRequest): PhotoSource {
  const assets = cloudflareBinding<{ fetch: (url: string) => Promise<Response> }>("ASSETS");
  const pub = path.join(process.cwd(), "public");
  const fromDisk = async (url: string) => {
    const file = path.join(pub, decodeURIComponent(new URL(url).pathname));
    if (!file.startsWith(pub + path.sep)) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(await readFile(file)));
  };
  return { host: request.headers.get("host") ?? new URL(request.url).host, fetch: assets ? (url) => assets.fetch(url) : fromDisk };
}

/** The verified scooter id to write this inspection under, or null (rate-limited, not a rental, chain unreachable). */
async function rememberAs(ip: string, lease: string, chainId: number | undefined) {
  // Counted before the chain read, so the limit also caps the RPC calls a caller can trigger.
  const rate = await hitRateLimit(getSharedState(), `settlement-memory:${ip}`, { limit: 20, windowMs: 3_600_000 });
  if (!rate.ok) return null;
  return leaseMemoryKey(lease, chainId).catch((err: Error) => {
    console.error("settlement: lease check failed, memory not written", err.name, err.message);
    return null;
  });
}
