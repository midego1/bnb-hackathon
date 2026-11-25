import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { encodeJson } from "@/lib/chainIndex";
import { friendlyError } from "@/lib/errors";
import { getStage, scrub, StageError } from "@/lib/server/demoTestnet/http"; // shared server chunks, see there

/**
 * The live stage demo (lib/server/stage). 404 unless STAGE_DEMO=1 on a chain 97 / 31337 build.
 *   GET  /api/stage/<slug>[?renter=0x..]   the item, its current rental (chain reads + events) and the phone's balances
 *   POST /api/stage/<slug>  {action: "drip" | "lease", address}   the judge's phone: test money, then the owner's offer
 *   POST /api/stage/<slug>  {action: "accept" | "reset", code?}   the presenter's buttons (server-signed by the owner)
 * Bigints are {"$n": "..."} (lib/chainIndex encodeJson).
 */
const address = z.string().refine((a) => isAddress(a), "not an address").transform((a) => getAddress(a));
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["drip", "lease"]), address }),
  z.object({ action: z.enum(["accept", "reset"]), code: z.string().max(100).optional() }),
]);

const json = (v: unknown, status = 200) => new Response(encodeJson(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof StageError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: e.retryAfterSec ? { "Retry-After": String(e.retryAfterSec) } : undefined });
    }
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    // A revert or an RPC failure: a plain sentence only, never internals (an RPC URL may hold a key).
    console.warn(`[stage] ${scrub(e instanceof Error ? e.message.split("\n")[0] : String(e))}`);
    return NextResponse.json({ error: scrub(friendlyError(e)) }, { status: 502 });
  }
}

export async function GET(request: Request, ctx: RouteContext<"/api/stage/[slug]">) {
  const stage = getStage();
  if (!stage) return new NextResponse("Not Found", { status: 404 });
  const { slug } = await ctx.params;
  const renter = new URL(request.url).searchParams.get("renter");
  if (renter !== null && !isAddress(renter)) return NextResponse.json({ error: "renter must be an address" }, { status: 400 });
  return run(() => stage.status(slug, renter ? getAddress(renter) : undefined));
}

export async function POST(request: Request, ctx: RouteContext<"/api/stage/[slug]">) {
  const stage = getStage();
  if (!stage) return new NextResponse("Not Found", { status: 404 });
  // Same-origin JSON only: a cross-site form post cannot spend test money or press the presenter's buttons.
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415 });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Cross-origin requests are refused." }, { status: 403 });
  const { slug } = await ctx.params;
  return run(async () => {
    const b = Body.parse(await request.json().catch(() => undefined));
    if ("address" in b) return b.action === "drip" ? stage.drip(slug, b.address) : stage.lease(slug, b.address);
    return b.action === "accept" ? stage.accept(slug, b.code) : stage.reset(slug, b.code);
  });
}
