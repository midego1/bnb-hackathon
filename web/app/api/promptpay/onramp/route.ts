import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { friendlyError } from "@/lib/errors";
import { DemoError } from "@/lib/server/demoTestnet/guards";
import { scrub } from "@/lib/server/demoTestnet/http";
import { simulateOnRamp } from "@/lib/server/onramp";

const Body = z.object({ lease: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/**
 * POST /api/promptpay/onramp {lease}: the simulated on-ramp of the "Pay with PromptPay" DEMO. Mints the test mUSDT due
 * on that rental to its renter (local anvil / BSC testnet only, rate-limited, capped). No real payment is checked.
 */
export async function POST(req: Request) {
  // Same-origin JSON only, like /api/demo-testnet: a cross-site form post cannot trigger mints.
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-origin requests are refused." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Bad request.", code: "bad-request" }, { status: 400 });
  try {
    return NextResponse.json(await simulateOnRamp(getAddress(parsed.data.lease)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DemoError) {
      return NextResponse.json(
        { error: e.message, code: e.code, retryAfterSec: e.retryAfterSec },
        { status: e.status, headers: e.retryAfterSec ? { "Retry-After": String(e.retryAfterSec) } : undefined },
      );
    }
    console.warn(`[promptpay-demo] ${scrub(e instanceof Error ? e.message.split("\n")[0] : String(e))}`);
    return NextResponse.json({ error: scrub(friendlyError(e)), code: "chain-error" }, { status: 502 });
  }
}
