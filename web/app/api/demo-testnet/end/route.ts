import { EndBody, handle } from "@/lib/server/demoTestnet/http";

/** POST /api/demo-testnet/end {runId}: free the lock; reports the gas the run burned. */
export async function POST(req: Request) {
  return handle(req, async (runner, body) => runner.end(EndBody.parse(body).runId));
}
