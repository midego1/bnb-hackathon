import { connection } from "next/server";
import { SecretValueError } from "@/lib/server/secrets/envFile";
import { body, guard, json, locked } from "@/lib/server/secrets/http";
import { listSecrets, SecretNameError, unitStates, writeSecret } from "@/lib/server/secrets/service";

/**
 * GET  /api/settings/secrets                         names with SET / NOT SET per file, restart units. Never values.
 * POST /api/settings/secrets {name, value}           writes the value into the name's .env file(s).
 * POST /api/settings/secrets {name, action:"clear"}  empties it.
 * Write-only by design: there is no endpoint that returns a value. Local-only, see docs/SETUP.md.
 */
export async function GET(req: Request) {
  await connection();
  const ctx = await guard(req, { write: false });
  if (ctx instanceof Response) return ctx;
  if (!ctx.authed) return locked();
  const [secrets, units] = await Promise.all([listSecrets(ctx.cfg), unitStates(ctx.cfg)]);
  return json({ secrets, units, restartEnabled: ctx.cfg.restart });
}

export async function POST(req: Request) {
  await connection();
  const ctx = await guard(req, { write: true });
  if (ctx instanceof Response) return ctx;
  if (!ctx.authed) return locked();
  const b = await body(req);
  if (!b || typeof b.name !== "string") return json({ error: "Bad request." }, 400);
  const clear = b.action === "clear";
  if (!clear && b.action !== undefined && b.action !== "set") return json({ error: "Bad request." }, 400);
  try {
    const r = await writeSecret(ctx.cfg, b.name, clear ? null : b.value, ctx.ip);
    return json({ name: r.name, set: r.set, savedAt: r.savedAt, restart: r.restart });
  } catch (e) {
    if (e instanceof SecretNameError) return json({ error: "This name cannot be set here." }, 400);
    if (e instanceof SecretValueError) return json({ error: e.message }, 400);
    console.warn("[settings/secrets] write failed"); // no details: an fs error could carry a path, never log the value
    return json({ error: "Could not write the env file." }, 500);
  }
}
