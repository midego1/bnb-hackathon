import { EndBody, handle } from "@/lib/server/demoTestnet/http";

/** POST /api/demo-testnet/end {runId}: free the lock; reports the gas the run burned. */
export async function POST(req: Request) {
  return handle(req, async (runner, body) => {
    const { runId, reason } = EndBody.parse(body);
    return runner.end(runId, reason);
  });
}
