import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { defaultChainId } from "@/lib/actions/context";
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from "@/lib/actions/fields";
import { rememberSettlement } from "@/lib/server/history";
import { clientIp, jsonError, zodIssues } from "@/lib/server/http";
import { getSharedState, hitRateLimit } from "@/lib/server/state";

const Body = z.object({
  lease: z.string().refine(isAddress, "lease must be a 0x address"),
  chainId: z.number().int().refine((n) => (SUPPORTED_CHAIN_IDS as readonly number[]).includes(n), "unsupported chain").optional(),
});

/**
 * POST /api/history {lease, chainId?} — after a rental settled (agreement, dispute ruling or timeout), write one factual
 * Living Brain capture per party (lib/server/history rememberSettlement). Everything comes from the chain index: the
 * body only names the rental. Idempotent per transaction. The rental page calls it once it shows "Settled".
 * Same limit as the scooter memory: 20 writes an hour per caller IP; over it nothing is written (200, `reason`).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid request", zodIssues(parsed.error));
  // Counted before the chain read, so the limit also caps the RPC calls a caller can trigger.
  const rate = await hitRateLimit(getSharedState(), `wallet-memory:${clientIp(request)}`, { limit: 20, windowMs: 3_600_000 });
  if (!rate.ok) return NextResponse.json({ stored: 0, skipped: 0, reason: "rate-limited" }, { headers: { "Cache-Control": "no-store" } });
  const chainId = (parsed.data.chainId ?? defaultChainId(process.env)) as SupportedChainId;
  try {
    return NextResponse.json(await rememberSettlement(getAddress(parsed.data.lease), chainId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("history: memory not written", (err as Error).name, (err as Error).message);
    return jsonError(502, "could not read the chain right now");
  }
}
