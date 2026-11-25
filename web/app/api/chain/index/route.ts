import { NextResponse } from "next/server";
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from "@/lib/actions/fields";
import { encodeJson } from "@/lib/chainIndex";
import { chainIndexer } from "@/lib/server/chainIndex";

/**
 * GET /api/chain/index?chainId=97[&minBlock=123]
 *
 * Every factory, rental escrow and Fleet Vault event of the KeyEscrow deployment on that chain, scanned server-side
 * (lib/server/chainIndex) and cached, so pages need no eth_getLogs of their own. `minBlock` (a block one of the
 * caller's own transactions was mined in) forces a refresh until the index reaches it. Bigints are {"$n": "..."}.
 * 503 + Retry-After when the RPC fails and nothing was cached yet; with a cached snapshot the answer is 200 + `stale`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chainId") ?? "");
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)) {
    return NextResponse.json({ error: `chainId must be one of ${SUPPORTED_CHAIN_IDS.join(", ")}` }, { status: 400 });
  }
  const minRaw = params.get("minBlock");
  if (minRaw !== null && !/^\d{1,20}$/.test(minRaw)) return NextResponse.json({ error: "minBlock must be a block number" }, { status: 400 });
  const indexer = chainIndexer(chainId as SupportedChainId);
  if (!indexer) return NextResponse.json({ error: `KeyEscrow is not deployed on chain ${chainId}` }, { status: 404 });
  try {
    const index = await indexer.get({ minBlock: minRaw === null ? undefined : BigInt(minRaw) });
    return new Response(encodeJson(index), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (err) {
    console.warn(`[chain-index] ${chainId}: ${(err as Error)?.message?.split("\n")[0]}`);
    return NextResponse.json(
      { error: "Could not read the chain right now: the public RPC refused or timed out. Retrying shortly." },
      { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } },
    );
  }
}
