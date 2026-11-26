import { NextResponse, type NextRequest } from "next/server";
import { getEvidenceStore } from "@/lib/server/evidence";
import { clientIp, jsonError, zodIssues } from "@/lib/server/http";
import { inspectionMemoryFromEnv } from "@/lib/server/sponsors/livingbrain";
import { getSharedState, hitRateLimit } from "@/lib/server/state";
import {
  inspectorFromEnv,
  PhotoResolutionError,
  ProposalRepairError,
  proposeSettlement,
  visionProviderFromEnv,
  VisionProviderError,
} from "@/lib/server/settlement";
import { leaseMemoryKey, SettlementRouteRequestSchema } from "@/lib/server/settlement/lease";

/**
 * POST /api/settlement — AI return inspection.
 * Body: { deposit, decimals?, currency?, checkIn: Photo[], checkOut: Photo[], notes?, scooterId?, lease?, chainId? }
 * Before judging, the inspector reads the scooter's inspection memory (Living Brain, or local). Only an inspection of
 * a `lease` this deployment's factory created (checked on-chain) is written back, under that rental's scooter
 * (settlement/lease.ts); a bare scooterId is read-only.
 * Returns a proposal whose tenantRefund + landlordClaim always equals the deposit.
 * Rate limits per caller IP: 10 live-model inspections an hour (each is a paid model call), and 20 memory writes an
 * hour (over it the inspection still runs, read-only).
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
    if (provider) {
      const rate = await hitRateLimit(getSharedState(), `settlement:${clientIp(request)}`, { limit: 10, windowMs: 3_600_000 });
      if (!rate.ok) return jsonError(429, `Too many AI inspections from this address. Try again in about ${Math.ceil(rate.retryAfterSec / 60)} min.`);
    }
    const { lease, chainId, ...req } = parsed.data;
    const result = await proposeSettlement(req, {
      provider,
      store: getEvidenceStore(),
      inspector: inspectorFromEnv(),
      memory: inspectionMemoryFromEnv(),
      rememberAs: lease ? await rememberAs(clientIp(request), lease, chainId) : null,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof PhotoResolutionError) return jsonError(400, err.message);
    if (err instanceof ProposalRepairError || err instanceof VisionProviderError) {
      return jsonError(502, `vision model output unusable: ${err.message}`);
    }
    console.error("settlement failed", (err as Error).name, (err as Error).message);
    return jsonError(502, "settlement provider failed");
  }
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
