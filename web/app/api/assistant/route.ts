import { connection } from "next/server";
import { handleRun } from "@/lib/assistant/http";
import { ALLOWED_MODELS, isMocked, modelId } from "@/lib/assistant/model";
import { MOCK_MODEL_ID } from "@/lib/assistant/mock";
import { assistantDeps } from "@/lib/server/assistant";

/** Ask AI: POST runs one message (or an approve/decline answer) and streams events; GET says which model answers. */
export async function POST(req: Request) {
  await connection();
  return handleRun(req, assistantDeps(new URL(req.url).origin));
}

export async function GET() {
  await connection();
  const mock = isMocked(process.env);
  return Response.json(
    { mock, model: mock ? MOCK_MODEL_ID : modelId(process.env), models: ALLOWED_MODELS, default: modelId(process.env) },
    { headers: { "cache-control": "no-store" } },
  );
}
