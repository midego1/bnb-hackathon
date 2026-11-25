import { NextResponse } from "next/server";
import { z } from "zod";
import { friendlyError } from "@/lib/errors";
import { onCloudflare } from "../platform";
import { getSharedState } from "../state";
import { getDemoTestnetRunner, type DemoTestnetRunner } from "./runner";
import { DemoError } from "./guards";
import { SharedRunStore } from "./store";

/**
 * Shared plumbing of the /api/demo-testnet/* routes. They exist only when the live testnet demo is switched on
 * (DEMO_TESTNET_RUNNER=1 on a chain 97 build with a secrets dir): otherwise every route answers a bare 404.
 */
export async function handle(req: Request | undefined, fn: (runner: DemoTestnetRunner, body: unknown) => Promise<unknown>) {
  // On Cloudflare Workers the lock and rate limit live in the KeyEscrowState Durable Object, not in isolate memory.
  const runner = onCloudflare() ? getDemoTestnetRunner(process.env, { store: (cfg) => new SharedRunStore(cfg, getSharedState) }) : getDemoTestnetRunner();
  if (!runner) return new NextResponse("Not Found", { status: 404 });
  return serve(req, (body) => fn(runner, body));
}

/** Same-origin JSON in, JSON out; refusals map to their status, anything else to a scrubbed 502. */
export async function serve(req: Request | undefined, fn: (body: unknown) => Promise<unknown>) {
  let body: unknown = undefined;
  if (req) {
    // Same-origin JSON only: a cross-site form post cannot start runs or send transactions.
    if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415 });
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-origin requests are refused." }, { status: 403 });
    body = await req.json().catch(() => undefined);
  }
  try {
    return NextResponse.json(await fn(body), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DemoError) {
      // Busy and rate-limited answers are expected (the browser retries them); every other refusal is worth a line.
      if (e.code !== "busy" && e.code !== "rate-limited") console.warn(`[demo-testnet] refused (${e.code}): ${scrub(e.message)}`);
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

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const owner = z.string().regex(/^[0-9a-zA-Z-]{8,64}$/);
const note = z
  .string()
  .max(1000)
  .optional()
  .transform((v) => (v ? scrub(v).replace(/[\r\n]+/g, " ").slice(0, 300) : undefined));
export const StartBody = z.object({ path: z.enum(["happy", "dispute"]), owner, lease: address.optional() });
export const ReadBody = z.object({ runId: z.string().uuid(), address, data: z.string().regex(/^0x[0-9a-fA-F]{8,2000}$/) });
export const PingBody = z.object({ runId: z.string().uuid(), error: note });
export const TxBody = z.object({
  runId: z.string().uuid(),
  role: z.enum(["landlord", "tenant", "arbiter"]),
  address,
  data: z.string().regex(/^0x[0-9a-fA-F]{8,20000}$/),
});
/** The PromptPay demo on-ramp (/api/demo-testnet/onramp). */
export const OnRampBody = z.object({ lease: address });
export const EndBody = z.object({ runId: z.string().uuid(), reason: note });

/** Drops URLs (an RPC URL can carry an API key) from anything that leaves the server or reaches the log. */
export const scrub = (s: string) => s.replace(/\b(?:https?|wss?):\/\/\S+/gi, "[rpc]");
