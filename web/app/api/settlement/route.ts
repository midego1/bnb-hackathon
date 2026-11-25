import { NextResponse, type NextRequest } from "next/server";
import { getEvidenceStore } from "@/lib/server/evidence";
import { jsonError, zodIssues } from "@/lib/server/http";
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
 * Body: { deposit, decimals?, currency?, checkIn: Photo[], checkOut: Photo[], notes? }
 * Returns a proposal whose tenantRefund + landlordClaim always equals the deposit.
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
    const result = await proposeSettlement(parsed.data, { provider, store: getEvidenceStore(), inspector: inspectorFromEnv() });
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
