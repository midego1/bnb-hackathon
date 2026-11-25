import { connection, NextResponse } from "next/server";
import { integrationStatus } from "@/lib/server/sponsors/status";

/** GET /api/integrations — sponsor integration status + recent call log (endpoint, time, status; never keys). */
export async function GET() {
  await connection();
  return NextResponse.json({ integrations: await integrationStatus() }, { headers: { "Cache-Control": "no-store" } });
}
