import { handle, ReadBody } from "@/lib/server/demoTestnet/http";

/** POST /api/demo-testnet/read {runId, address, data}: eth_call on this run's contracts at its latest receipt block. */
export async function POST(req: Request) {
  return handle(req, (runner, body) => {
    const { runId, address, data } = ReadBody.parse(body);
    return runner.read(runId, { address, data: data as `0x${string}` });
  });
}
