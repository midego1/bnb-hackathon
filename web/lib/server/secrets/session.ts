import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Admin passcode of the secrets page. The server generates it on first use into <state>/secrets/settings-passcode
 * (mode 600); the owner reads it on the box with `cat`. It is never printed, logged or sent to the browser.
 *
 * A correct passcode buys a short session cookie: `<expiry ms>.<HMAC(passcode-derived key, expiry)>`. It is stateless,
 * so it survives a restart of the web unit, and replacing the passcode file ends every session.
 */

export const SESSION_COOKIE = "keyescrow_secrets_session";
export const SESSION_TTL_MS = 15 * 60_000;

export async function ensurePasscode(file: string): Promise<string> {
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const passcode = randomBytes(18).toString("base64url"); // 24 characters
  try {
    const fh = await open(file, "wx", 0o600);
    try {
      await fh.writeFile(`${passcode}\n`, "utf8");
    } finally {
      await fh.close();
    }
    return passcode;
  } catch (e) {
    // Another request created it first: use theirs.
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return (await readFile(file, "utf8")).trim();
    throw e;
  }
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function passcodeMatches(input: unknown, passcode: string): boolean {
  if (typeof input !== "string" || !input || input.length > 200 || !passcode) return false;
  return timingSafeEqual(digest(input.trim()), digest(passcode));
}

const sessionKey = (passcode: string) => digest(`keyescrow-settings-secrets|${passcode}`);
const sign = (passcode: string, exp: number) => createHmac("sha256", sessionKey(passcode)).update(`v1.${exp}`).digest("base64url");

export function createSessionToken(passcode: string, now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const exp = now + ttlMs;
  return `${exp}.${sign(passcode, exp)}`;
}

export function sessionValid(token: string | undefined | null, passcode: string, now = Date.now()): boolean {
  if (!token || !passcode) return false;
  const m = /^(\d{13,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > now) || exp > now + SESSION_TTL_MS + 60_000) return false;
  const want = Buffer.from(sign(passcode, exp));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Set-Cookie value: httpOnly, SameSite=Strict, scoped to the API, short TTL (Secure when served over https). */
export function sessionCookie(token: string | null, secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=${token ?? ""}`, "Path=/api/settings/secrets", "HttpOnly", "SameSite=Strict"];
  attrs.push(token ? `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` : "Max-Age=0");
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function readCookie(header: string | null, name = SESSION_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
