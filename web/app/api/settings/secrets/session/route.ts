import { connection } from "next/server";
import { guard as secretsGuard, body, json } from "@/lib/server/secrets/http";
import { limiters } from "@/lib/server/secrets/guard";
import { createSessionToken, passcodeMatches, sessionCookie } from "@/lib/server/secrets/session";

/**
 * GET    /api/settings/secrets/session              {unlocked} (also creates the passcode file on first use)
 * POST   /api/settings/secrets/session {passcode}   checks the passcode, sets a short httpOnly SameSite=Strict cookie
 * DELETE /api/settings/secrets/session              locks the page again
 * The passcode lives in <main checkout>/.orca/secrets/settings-passcode (mode 600): `cat` it on the box.
 */
export async function GET(req: Request) {
  await connection();
  const ctx = await secretsGuard(req, { write: false });
  if (ctx instanceof Response) return ctx;
  return json({ unlocked: ctx.authed });
}

export async function POST(req: Request) {
  await connection();
  const ctx = await secretsGuard(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const l = limiters();
  if (!l.passcode.take(ctx.ip ?? "?") || !l.passcodeAll.take("all")) {
    return json({ error: "Too many attempts. Wait a few minutes." }, 429, { "Retry-After": "300" });
  }
  const b = await body(req);
  if (!passcodeMatches(b?.passcode, ctx.passcode)) return json({ error: "Wrong passcode." }, 401);
  return json({ unlocked: true }, 200, { "Set-Cookie": sessionCookie(createSessionToken(ctx.passcode), ctx.secure) });
}

export async function DELETE(req: Request) {
  await connection();
  const ctx = await secretsGuard(req, { write: true });
  if (ctx instanceof Response) return ctx;
  return json({ unlocked: false }, 200, { "Set-Cookie": sessionCookie(null, ctx.secure) });
}
