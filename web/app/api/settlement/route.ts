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
  SettlementRequestSchema,
  visionProviderFromEnv,
  VisionProviderError,
} from "@/lib/server/settlement";

/**
 * POST /api/settlement — AI return inspection.
 * Body: { deposit, decimals?, currency?, checkIn: Photo[], checkOut: Photo[], notes?, scooterId? }
 * With scooterId the inspector first reads that scooter's inspection memory (Living Brain, or local) and writes this one back.
 * Returns a proposal whose tenantRefund + landlordClaim always equals the deposit.
 * With a live vision model each caller IP gets 10 inspections an hour: each one is a paid model call.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = SettlementRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid settlement request", zodIssues(parsed.error));

  try {
    const provider = visionProviderFromEnv();
    if (provider) {
      const rate = await hitRateLimit(getSharedState(), `settlement:${clientIp(request)}`, { limit: 10, windowMs: 3_600_000 });
      if (!rate.ok) return jsonError(429, `Too many AI inspections from this address. Try again in about ${Math.ceil(rate.retryAfterSec / 60)} min.`);
    }
    const result = await proposeSettlement(parsed.data, { provider, store: getEvidenceStore(), inspector: inspectorFromEnv(), memory: inspectionMemoryFromEnv() });
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
