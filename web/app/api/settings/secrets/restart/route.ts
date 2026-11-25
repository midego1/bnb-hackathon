import { connection } from "next/server";
import { body, guard, json, locked } from "@/lib/server/secrets/http";
import { audit, restartUnit, SecretNameError } from "@/lib/server/secrets/service";

/**
 * POST /api/settings/secrets/restart {unit}: `systemctl --user --no-block restart <unit>` for an allowlisted unit
 * (keyescrow-web, keyescrow-web-testnet). Detached, so the web server may restart itself; the page polls
 * GET /api/settings/secrets until the unit is back.
 */
export async function POST(req: Request) {
  await connection();
  const ctx = await guard(req, { write: true });
  if (ctx instanceof Response) return ctx;
  if (!ctx.authed) return locked();
  const b = await body(req);
  try {
    const unit = restartUnit(ctx.cfg, b?.unit);
    await audit(ctx.cfg, { time: new Date(), name: unit, action: "restart", targets: [], ip: ctx.ip }).catch(() => {});
    return json({ unit, restarting: true }, 202);
  } catch (e) {
    if (e instanceof SecretNameError) return json({ error: "This unit cannot be restarted here." }, 400);
    return json({ error: "Could not restart." }, 500);
  }
}
