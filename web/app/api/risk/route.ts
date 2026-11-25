import { connection, NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/server/http";
import { getRiskService } from "@/lib/server/risk";

/**
 * GET /api/risk?depositThb=3000&days=30 — deposit buffer per payment token (USDT, BNB) from live
 * CoinMarketCap quotes + the latest stored Cournot probability. CMC is called server-side only and logged.
 */
export async function GET(request: NextRequest) {
  await connection();
  const p = request.nextUrl.searchParams;
  const depositThb = Number(p.get("depositThb") ?? "0");
  const days = Number(p.get("days") ?? "30");
  if (!Number.isFinite(depositThb) || depositThb <= 0 || depositThb > 10_000_000) return jsonError(400, "depositThb must be a positive THB amount");
  if (!Number.isFinite(days) || days < 1 || days > 3660) return jsonError(400, "days must be 1 to 3660");
  const risk = await getRiskService().assess(depositThb, days);
  return NextResponse.json(risk, { headers: { "Cache-Control": "no-store" } });
}
