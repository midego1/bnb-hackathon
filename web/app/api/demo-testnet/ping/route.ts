import { handle, PingBody } from "@/lib/server/demoTestnet/http";

/** POST /api/demo-testnet/ping {runId, error?}: keeps the run's lock while it plays; logs a step error the viewer saw. */
export async function POST(req: Request) {
  return handle(req, async (runner, body) => {
    const { runId, error } = PingBody.parse(body);
    return runner.ping(runId, error);
  });
}
