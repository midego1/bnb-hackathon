import { handle, StartBody } from "@/lib/server/demoTestnet/http";

/** POST /api/demo-testnet/run {path}: start a live run on BSC testnet (one at a time, rate limited). */
export async function POST(req: Request) {
  return handle(req, (runner, body) => runner.start(StartBody.parse(body).path));
}
