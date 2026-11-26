import { connection, NextResponse } from "next/server";
import { getPriceService } from "@/lib/server/price";
import { getAtlas } from "@/lib/server/price/atlas";

/**
 * GET /api/price — USDT and BNB in USD and THB.
 * Source order: Atlas on-chain feeds -> CoinMarketCap Pro (server-side key) -> static mock.
 * Cached in memory for PRICE_CACHE_TTL_SECONDS (default 60). `atlas`: the Atlas BNB/USD push feed + Pull API
 * consensus that guard "Pay with BNB" (lib/server/price/atlas.ts, cached 30 s), so the browser caches 30 s at most.
 */
export async function GET() {
  await connection(); // always evaluate at request time, never prerender at build
  const service = getPriceService();
  const [quote, { status: atlas }] = await Promise.all([service.get(), getAtlas()]);
  const maxAge = Math.min(30, Math.floor(service.ttlMs / 1000));
  return NextResponse.json({ ...quote, atlas }, {
    headers: { "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}` },
  });
}
