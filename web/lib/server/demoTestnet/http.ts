import { NextResponse } from "next/server";
import { z } from "zod";
import { friendlyError } from "@/lib/errors";
import { getDemoTestnetRunner, type DemoTestnetRunner } from "./runner";
import { DemoError } from "./guards";

/**
 * Shared plumbing of the /api/demo-testnet/* routes. They exist only when the live testnet demo is switched on
 * (DEMO_TESTNET_RUNNER=1 on a chain 97 build with a secrets dir): otherwise every route answers a bare 404.
 */
export async function handle(req: Request | undefined, fn: (runner: DemoTestnetRunner, body: unknown) => Promise<unknown>) {
  const runner = getDemoTestnetRunner();
  if (!runner) return new NextResponse("Not Found", { status: 404 });
  let body: unknown = undefined;
  if (req) {
    // Same-origin JSON only: a cross-site form post cannot start runs or send transactions.
    if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415 });
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-origin requests are refused." }, { status: 403 });
    body = await req.json().catch(() => undefined);
  }
  try {
    return NextResponse.json(await fn(runner, body), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DemoError) {
      return NextResponse.json(
        { error: e.message, code: e.code, retryAfterSec: e.retryAfterSec },
        { status: e.status, headers: e.retryAfterSec ? { "Retry-After": String(e.retryAfterSec) } : undefined },
      );
    }
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Bad request.", code: "bad-request" }, { status: 400 });
    // A contract revert or RPC failure: the plain-language message only, never internals (the RPC URL may hold a key).
    console.warn(`[demo-testnet] ${scrub(e instanceof Error ? e.message.split("\n")[0] : String(e))}`);
    return NextResponse.json({ error: scrub(friendlyError(e)), code: "chain-error" }, { status: 502 });
  }
}

export const StartBody = z.object({ path: z.enum(["happy", "dispute"]) });
export const TxBody = z.object({
  runId: z.string().uuid(),
  role: z.enum(["landlord", "tenant", "arbiter"]),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  data: z.string().regex(/^0x[0-9a-fA-F]{8,20000}$/),
});
export const EndBody = z.object({ runId: z.string().uuid() });

/** Drops URLs (an RPC URL can carry an API key) from anything that leaves the server or reaches the log. */
export const scrub = (s: string) => s.replace(/\b(?:https?|wss?):\/\/\S+/gi, "[rpc]");
