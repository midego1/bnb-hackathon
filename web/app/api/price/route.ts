import { connection, NextResponse } from "next/server";
import { getPriceService } from "@/lib/server/price";

/**
 * GET /api/price — USDT and BNB in USD and THB.
 * Source order: Atlas on-chain feeds -> CoinMarketCap Pro (server-side key) -> static mock.
 * Cached in memory for PRICE_CACHE_TTL_SECONDS (default 60).
 */
export async function GET() {
  await connection(); // always evaluate at request time, never prerender at build
  const service = getPriceService();
  const quote = await service.get();
  const maxAge = Math.floor(service.ttlMs / 1000);
  return NextResponse.json(quote, {
    headers: { "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}` },
  });
}
