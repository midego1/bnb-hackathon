import { NextResponse } from "next/server";
import { buildOpenApi } from "@/lib/actions/openapi";

/** GET /api/v1/openapi.json: OpenAPI 3.1, generated from lib/actions/definitions.ts. */
export function GET() {
  return NextResponse.json(buildOpenApi(), { headers: { "Cache-Control": "public, max-age=300" } });
}
