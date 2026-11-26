import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, open, readdir, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { SecretFormat, SecretSpec } from "./registry";

/**
 * Editing dotenv files for the secrets page. Values are written unquoted as NAME=value, so the value charset is
 * restricted to what every reader in the repo parses the same way (Next's dotenv + dotenv-expand, testnet.sh's bash
 * loader, the agent's and chain97's parsers): printable ASCII without whitespace, quotes, backslash, `$` (expanded by
 * dotenv-expand) and `#` (starts a comment in dotenv).
 *
 * Error messages never contain the value.
 */

export class SecretValueError extends Error {
  constructor(message = "Invalid value.") {
    super(message);
  }
}

const DEFAULT_MAX = 512;
const SAFE = /^[\x21-\x7E]+$/;
const FORBIDDEN = /["'`$#\\]/;

const FORMATS: Record<SecretFormat, { re: RegExp; hint: string }> = {
  token: { re: /^[A-Za-z0-9._~:+/=-]{8,}$/, hint: "an API key (letters, digits, - _ . : + / =)" },
  privateKey: { re: /^0x[0-9a-fA-F]{64}$/, hint: "0x followed by 64 hex characters" },
  jwt: { re: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, hint: "a JWT (three base64url parts separated by dots)" },
  url: { re: /^(?:https?|wss?):\/\/[^\s]+$/, hint: "an http(s):// or ws(s):// URL" },
  uuid: { re: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, hint: "a UUID" },
  digits: { re: /^[0-9]{1,12}$/, hint: "a number" },
  bucket: { re: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, hint: "a bucket name (lowercase letters, digits, -)" },
  hex32: { re: /^[0-9a-fA-F]{32}$/, hint: "32 hex characters" },
  // CoinMarketCap Pro keys: older ones are UUIDs, current ones 32 hex characters without dashes.
  cmc: { re: /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, hint: "a CoinMarketCap key (32 hex characters or a UUID)" },
  anthropic: { re: /^sk-ant-[A-Za-z0-9_-]{20,}$/, hint: "an Anthropic key (sk-ant-...)" },
  // As lib/server/sponsors/cournot.ts reads them: other keys and bases are ignored or refused there.
  cournot: { re: /^ck_live_[A-Za-z0-9_-]{1,256}$/, hint: "a Cournot key (ck_live_...)" },
  cournotBase: { re: /^https:\/\/(dev-)?interface\.cournot\.ai\/?$/, hint: "https://interface.cournot.ai or https://dev-interface.cournot.ai" },
};

/** What the value should look like, for the UI and the error message. Never derived from the value. */
export const formatHint = (format: SecretFormat) => FORMATS[format].hint;
export const matchesFormat = (format: SecretFormat, value: string) => FORMATS[format].re.test(value);

/** Validates a submitted value and returns it without surrounding spaces. Throws SecretValueError (no value in it). */
export function validateSecretValue(spec: SecretSpec, raw: unknown): string {
  if (typeof raw !== "string") throw new SecretValueError();
  if (/[\r\n\0]/.test(raw)) throw new SecretValueError("Invalid value: line breaks are not allowed.");
  const value = raw.trim();
  if (!value) throw new SecretValueError("Invalid value: empty.");
  if (value.length > (spec.maxLength ?? DEFAULT_MAX)) throw new SecretValueError("Invalid value: too long.");
  if (!SAFE.test(value) || FORBIDDEN.test(value)) {
    throw new SecretValueError("Invalid value: spaces, quotes, backslashes, $ and # are not allowed.");
  }
  if (!FORMATS[spec.format].re.test(value)) throw new SecretValueError(`Invalid value: expected ${formatHint(spec.format)}.`);
  return value;
}

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const lineRe = (name: string) => new RegExp(`^(\\s*(?:export\\s+)?)${name}\\s*=(.*)$`);

/**
 * Sets (value) or clears (null) NAME in a dotenv text. Every NAME= line is rewritten in place (keeping an `export`
 * prefix and a CRLF ending); a clear leaves `NAME=`. A missing name is appended. All other lines, comments included,
 * stay byte for byte. Commented-out lines (`# NAME=...`) are left alone.
 */
export function setEnvValue(text: string, name: string, value: string | null): string {
  if (!NAME_RE.test(name)) throw new Error("bad name");
  if (value !== null && (/[\r\n]/.test(value) || !value)) throw new SecretValueError();
  const re = lineRe(name);
  const lines = text.split("\n");
  let found = false;
  const out = lines.map((line) => {
    const cr = line.endsWith("\r") ? "\r" : "";
    const m = re.exec(cr ? line.slice(0, -1) : line);
    if (!m) return line;
    found = true;
    return `${m[1]}${name}=${value ?? ""}${cr}`;
  });
  if (found) return out.join("\n");
  if (value === null) return text;
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${sep}${name}=${value}\n`;
}

/** Whether NAME has a non-empty value (the last NAME= line wins, as with Next's dotenv). Never returns the value. */
export function isEnvSet(text: string, name: string): boolean {
  const re = lineRe(name);
  let set = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = re.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    set = v.length > 0;
  }
  return set;
}

/** The value of NAME (last NAME= line wins, quotes stripped), for server-side key tests only. Never sent anywhere. */
export function envValue(text: string, name: string): string | undefined {
  const re = lineRe(name);
  let value: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const m = re.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    value = v || undefined;
  }
  return value;
}

export async function readEnvText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

const KEEP_BACKUPS = 10;

/** Copies the current file into backupDir as <label>.<timestamp>.bak (mode 600) and keeps the newest 10 of them. */
async function backup(file: string, backupDir: string, label: string, now: Date) {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `${label}.${stamp}.${randomBytes(2).toString("hex")}.bak`);
  await copyFile(file, dest);
  await chmod(dest, 0o600);
  const mine = (await readdir(backupDir)).filter((f) => f.startsWith(`${label}.`) && f.endsWith(".bak")).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_BACKUPS))) await unlink(path.join(backupDir, old)).catch(() => {});
}

/** Atomic replace: a mode-600 temp file next to the target, fsync, rename. Backs the old file up first (if any). */
export async function writeEnvFileAtomic(file: string, text: string, opts: { backupDir: string; label: string; now?: Date }) {
  let target = file;
  let existed = true;
  try {
    target = await realpath(file); // keep a symlinked .env a symlink
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    existed = false;
  }
  if (existed) await backup(target, opts.backupDir, opts.label, opts.now ?? new Date());
  else await mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  const fh = await open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(text, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await chmod(tmp, 0o600);
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}
