import { handle, TxBody } from "@/lib/server/demoTestnet/http";

/** POST /api/demo-testnet/tx {runId, role, address, data}: sign one allowlisted demo call on chain 97, return its receipt. */
export async function POST(req: Request) {
  return handle(req, (runner, body) => {
    const { runId, ...call } = TxBody.parse(body);
    return runner.tx(runId, call);
  });
}
