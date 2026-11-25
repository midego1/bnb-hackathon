import { settingsSecretsEnabled } from "@/lib/secretsDeployGuard";
import { checkRequest, clientIp, limiters } from "./guard";
import { passcodeFile, secretsConfig, type SecretsConfig } from "./service";
import { ensurePasscode, readCookie, sessionValid } from "./session";

/**
 * Shared plumbing of /api/settings/secrets/*. Every answer is no-store JSON; a disabled page answers a bare 404; no
 * answer ever contains a submitted value or the passcode.
 */

type Env = Record<string, string | undefined>;

const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...NO_STORE, ...extra } });
}

export const notFound = () => new Response("Not Found", { status: 404, headers: NO_STORE });

export type Ctx = { cfg: SecretsConfig; ip: string | null; passcode: string; authed: boolean; secure: boolean };

/**
 * Runs the guards: enabled, network, same-origin, rate limit, then loads (or creates) the passcode and checks the
 * session cookie. Returns a Response to send as is, or the context.
 */
export async function guard(req: Request, opts: { write: boolean; env?: Env }): Promise<Response | Ctx> {
  const env = opts.env ?? process.env;
  if (!settingsSecretsEnabled(env)) return notFound();
  const bad = checkRequest(req, env, opts.write);
  if (bad) return json({ error: bad.error }, bad.status);
  const ip = clientIp(req.headers);
  const l = limiters();
  if (!(opts.write ? l.write : l.read).take(ip ?? "?")) return json({ error: "Too many requests. Try again in a few minutes." }, 429, { "Retry-After": "60" });
  const cfg = secretsConfig(env);
  const passcode = await ensurePasscode(passcodeFile(cfg));
  const authed = sessionValid(readCookie(req.headers.get("cookie")), passcode);
  const secure = new URL(req.url).protocol === "https:";
  return { cfg, ip, passcode, authed, secure };
}

export const locked = () => json({ error: "Enter the passcode first.", locked: true }, 401);

/** JSON body or undefined. The parse error is never echoed (it could quote the value). */
export async function body(req: Request): Promise<Record<string, unknown> | undefined> {
  const raw = await req.text().catch(() => "");
  if (raw.length > 16_384) return undefined;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
