import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, zodIssues } from "@/lib/server/http";
import { recentSponsorCalls } from "@/lib/server/sponsors/log";
import { cournotConfig, CournotError, evaluateClaim, saveResult, storedResults } from "@/lib/server/sponsors/cournot";

/** GET /api/cournot — stored Cournot answers (newest first) and the call log. Never calls Cournot. */
export async function GET() {
  await connection();
  const cfg = cournotConfig();
  const results = await storedResults();
  return NextResponse.json(
    { live: cfg.live ? "enabled" : "disabled", base: cfg.base, prepaidKey: Boolean(cfg.apiKey), results: results.slice(0, 10), calls: await recentSponsorCalls("cournot", 20) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const Body = z.object({
  claim: z.string().min(20).max(300).regex(/\bBNB\b/, "claim must name the asset (BNB)").regex(/\$\d/, "claim needs a USD threshold").regex(/\d{4}-\d{2}-\d{2}/, "claim needs a date"),
  /** Must be true: each live call can use one of only three free calls per IP. */
  confirm: z.literal(true),
});

/**
 * POST /api/cournot {claim, confirm: true} — evaluate a claim. Reuses a stored answer for the same claim; only
 * calls Cournot live when COURNOT_LIVE=1 and fewer than COURNOT_MAX_LIVE_CALLS (default 3) answers are stored.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid claim", zodIssues(parsed.error));
  const { claim } = parsed.data;

  const stored = await storedResults();
  const hit = stored.find((r) => r.claim === claim);
  if (hit) return NextResponse.json({ ...hit, source: "cache" });

  const cfg = cournotConfig();
  if (!cfg.live) return jsonError(409, "Live Cournot calls are off on this server (COURNOT_LIVE is not 1). Showing stored answers only.");
  const cap = Number(process.env.COURNOT_MAX_LIVE_CALLS ?? "3");
  const used = stored.filter((r) => r.source === "live").length;
  if (!cfg.apiKey && used >= cap) return jsonError(429, `This server already made ${used} live Cournot call(s) (cap ${cap}); further calls would need payment.`);

  try {
    const result = await evaluateClaim(claim, cfg);
    await saveResult(result);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CournotError) {
      const status = err.state === "payment_required" ? 402 : err.state === "rate_limited" ? 429 : err.state === "no_market" ? 422 : 502;
      return jsonError(status, err.message, { state: err.state });
    }
    return jsonError(502, "Cournot call failed");
  }
}
