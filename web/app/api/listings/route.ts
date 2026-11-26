import { NextResponse } from "next/server";
import { LISTING_THB_PER_USDT, LISTINGS, listingJson } from "@/lib/listings";
import { requestOrigin } from "@/lib/server/http";

/**
 * GET /api/listings   the one catalogue of the website and the iOS app (web/data/listings.json): every listing with
 * its prices in THB and its photos (absolute URLs on this host, each with its Wikimedia Commons credit).
 */
export function GET(request: Request) {
  const origin = requestOrigin(request);
  return NextResponse.json(
    { thbPerUsdt: LISTING_THB_PER_USDT, listings: LISTINGS.map((l) => listingJson(l, origin)) },
    // Public and the same for everyone: browsers and the iOS app may keep it for 5 minutes.
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
