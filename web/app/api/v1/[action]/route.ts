import { connection } from "next/server";
import { handleActionRequest } from "@/lib/actions/rest";
import { webActionHost } from "@/lib/server/actions";

/**
 * /api/v1/<action>: every KeyScrow rental action from lib/actions/definitions.ts.
 * GET for reads (query string), POST for prepare_* (JSON body; returns unsigned, simulated transactions).
 * Spec: GET /api/v1/openapi.json. Docs: /developers.
 */
type Ctx = { params: Promise<{ action: string }> };

async function handle(req: Request, { params }: Ctx) {
  await connection();
  const { action } = await params;
  return handleActionRequest(req, action, webActionHost());
}

export const GET = handle;
export const POST = handle;
