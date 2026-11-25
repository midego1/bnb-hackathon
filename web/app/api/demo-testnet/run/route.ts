import { handle, StartBody } from "@/lib/server/demoTestnet/http";
import { clientIp } from "@/lib/server/http";

/** POST /api/demo-testnet/run {path, owner, lease?}: start a live run on BSC testnet (one at a time, rate limited; the
 * same browser may take over its own run, and a run whose lock lapsed may resume its demo lease). */
export async function POST(req: Request) {
  return handle(req, (runner, body) => {
    const { path, owner, lease } = StartBody.parse(body);
    return runner.start(path, owner, lease as `0x${string}` | undefined, clientIp(req));
  });
}
