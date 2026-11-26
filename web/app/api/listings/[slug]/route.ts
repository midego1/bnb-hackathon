import { NextResponse } from "next/server";
import { getListing, listingJson } from "@/lib/listings";
import { jsonError, requestOrigin } from "@/lib/server/http";

/** GET /api/listings/<slug>   one listing of the catalogue, in the same shape as an item of GET /api/listings. */
export async function GET(request: Request, ctx: RouteContext<"/api/listings/[slug]">) {
  const listing = getListing((await ctx.params).slug);
  if (!listing) return jsonError(404, "There is no such listing.");
  return NextResponse.json(listingJson(listing, requestOrigin(request)), { headers: { "Cache-Control": "public, max-age=300" } });
}
