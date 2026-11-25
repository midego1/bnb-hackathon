/**
 * Request guards of the secrets page: local/tailnet clients only, same-origin, rate limited.
 *
 * Caveat: `next start` / `next dev` fill X-Forwarded-For from the socket only when the client did not send one, so the
 * IP check is a filter, not a boundary. The boundaries are the bind address of the units (the Tailscale IP), the Host
 * check (a public hostname from a tunnel or proxy is refused, as are Cloudflare's headers) and the passcode.
 */

type Env = Record<string, string | undefined>;

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

const CGNAT_BASE = ipv4ToInt("100.64.0.0")!;
const CGNAT_MASK = 0xffc00000; // /10

/** 127.0.0.1, ::1 and Tailscale's 100.64.0.0/10 (also as IPv4-mapped IPv6). */
export function isAllowedIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  let v = ip.trim().toLowerCase();
  if (v === "::1" || v === "[::1]") return true;
  if (v.startsWith("::ffff:")) v = v.slice(7);
  if (v === "127.0.0.1") return true;
  const n = ipv4ToInt(v);
  return n !== null && ((n & CGNAT_MASK) >>> 0) === CGNAT_BASE;
}

/** Hostname part of a Host header (no port, IPv6 brackets dropped). */
function hostname(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.replace(/:\d+$/, "");
}

/** localhost, a loopback/tailnet IP, a MagicDNS name (*.ts.net) or a name listed in SETTINGS_SECRETS_HOSTS. */
export function isAllowedHost(host: string | null, env: Env = {}): boolean {
  if (!host) return false;
  const h = hostname(host);
  if (h === "localhost" || isAllowedIp(h) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(h)) return true;
  const extra = (env.SETTINGS_SECRETS_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return extra.includes(h);
}

/** Headers that mean a CDN or proxy sits in front: the page never runs behind one. */
const PROXY_HEADERS = ["cf-connecting-ip", "cf-ray", "cdn-loop", "true-client-ip", "x-real-ip", "forwarded", "via"];

export type GuardFailure = { status: number; error: string };

/** The client IP as the Next server saw it, or null when the request came through a proxy chain. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (!xff) return null;
  const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return hops.length === 1 ? hops[0] : null;
}

/** Network + CSRF checks. `write`: a state-changing request, which needs a same-origin Origin header and JSON. */
export function checkRequest(req: Request, env: Env, write: boolean): GuardFailure | null {
  const h = req.headers;
  if (PROXY_HEADERS.some((k) => h.has(k))) return { status: 403, error: "Not available through a proxy." };
  if (!isAllowedIp(clientIp(h))) return { status: 403, error: "Only from this machine or the tailnet." };
  const host = h.get("host");
  if (!isAllowedHost(host, env)) return { status: 403, error: "Only from this machine or the tailnet." };
  const origin = h.get("origin");
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return { status: 403, error: "Cross-site requests are refused." };
  if (origin || write) {
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== host) return { status: 403, error: "Cross-site requests are refused." };
  }
  if (write && !(h.get("content-type") ?? "").includes("application/json")) return { status: 415, error: "Send JSON." };
  return null;
}

/** Sliding-window rate limiter (in memory, per server process; survives dev hot reloads via globalThis). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit; false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
    return true;
  }
}

type Limiters = { passcode: RateLimiter; passcodeAll: RateLimiter; write: RateLimiter; read: RateLimiter; test: RateLimiter };
const g = globalThis as typeof globalThis & { __keyescrowSecretsLimiters?: Limiters };

export function limiters(): Limiters {
  return (g.__keyescrowSecretsLimiters ??= {
    passcode: new RateLimiter(5, 5 * 60_000), // per IP
    passcodeAll: new RateLimiter(20, 5 * 60_000), // all clients together
    write: new RateLimiter(30, 5 * 60_000),
    read: new RateLimiter(120, 60_000),
    test: new RateLimiter(10, 5 * 60_000), // key tests reach outside APIs: 10 per 5 minutes per IP
  });
}
