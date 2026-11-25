import { NextResponse } from "next/server";
import { FleetError, fleetActionSchema, getFleetStore } from "@/lib/server/fleet";
import { jsonError, zodIssues } from "@/lib/server/http";

/**
 * GET  /api/fleet?chainId=97      scooter catalogue + booking requests for a chain
 * POST /api/fleet?chainId=97      { action: "addScooter" | "book" | "offer" | "decline" | "linkRental", ... }
 *
 * Demo-grade listing store: requests are not signed, so anyone can add a listing or a booking request. Nothing here
 * moves money; rentals are only real once an escrow exists on-chain.
 */
function chainOf(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("chainId") ?? "31337");
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export async function GET(request: Request) {
  const chainId = chainOf(request);
  if (!chainId) return jsonError(400, "chainId must be a positive integer");
  return NextResponse.json(await getFleetStore().read(chainId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const chainId = chainOf(request);
  if (!chainId) return jsonError(400, "chainId must be a positive integer");
  const parsed = fleetActionSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return jsonError(400, "invalid fleet action", zodIssues(parsed.error));
  try {
    return NextResponse.json(await getFleetStore().apply(chainId, parsed.data));
  } catch (err) {
    if (err instanceof FleetError) return jsonError(err.status, err.message);
    throw err;
  }
}
