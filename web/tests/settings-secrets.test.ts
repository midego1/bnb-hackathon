import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (request-time rendering); outside a Next request scope it is a no-op here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
import { assertSecretsPageBuildAllowed, settingsSecretsEnabled } from "@/lib/secretsDeployGuard";
import { isEnvSet, setEnvValue, validateSecretValue, writeEnvFileAtomic } from "@/lib/server/secrets/envFile";
import { checkRequest, isAllowedHost, isAllowedIp, RateLimiter } from "@/lib/server/secrets/guard";
import { restartUnits, secretSpec, SECRETS } from "@/lib/server/secrets/registry";
import { isTestable } from "@/lib/server/secrets/testers";
import { auditFile, listSecrets, passcodeFile, restartUnit, secretsConfig, writeSecret, type Systemctl } from "@/lib/server/secrets/service";
import { createSessionToken, ensurePasscode, passcodeMatches, readCookie, sessionCookie, sessionValid, SESSION_TTL_MS } from "@/lib/server/secrets/session";
import { secretsPageAllowed } from "@/lib/server/secrets/page";
import nextConfig from "@/next.config";
import { GET, POST } from "@/app/api/settings/secrets/route";
import { POST as SESSION_POST } from "@/app/api/settings/secrets/session/route";
import { POST as RESTART_POST } from "@/app/api/settings/secrets/restart/route";
import { POST as TEST_POST } from "@/app/api/settings/secrets/test/route";

const KEY = `0x${"ab".repeat(32)}`;
const spec = (name: string) => secretSpec(name)!;

describe("dotenv editing", () => {
  const base = "# Chain\nBSC_TESTNET_RPC_URL=https://old.example\n\n# keep me\nexport BSCSCAN_API_KEY=OLDKEY123\nOTHER=1\n# CMC_API_KEY=commented\n";

  it("replaces an existing line and keeps every other line byte for byte", () => {
    const out = setEnvValue(base, "BSC_TESTNET_RPC_URL", "https://new.example/v1");
    expect(out).toBe(base.replace("https://old.example", "https://new.example/v1"));
  });

  it("keeps an export prefix and CRLF endings", () => {
    expect(setEnvValue(base, "BSCSCAN_API_KEY", "NEWKEY456")).toContain("export BSCSCAN_API_KEY=NEWKEY456\n");
    expect(setEnvValue("A=1\r\nCMC_API_KEY=x\r\nB=2\r\n", "CMC_API_KEY", "y")).toBe("A=1\r\nCMC_API_KEY=y\r\nB=2\r\n");
  });

  it("appends a missing name (adding a final newline if needed) and leaves commented lines alone", () => {
    const out = setEnvValue(base, "CMC_API_KEY", "v");
    expect(out).toBe(`${base}CMC_API_KEY=v\n`);
    expect(setEnvValue("A=1", "CMC_API_KEY", "v")).toBe("A=1\nCMC_API_KEY=v\n");
    expect(setEnvValue("", "CMC_API_KEY", "v")).toBe("CMC_API_KEY=v\n");
  });

  it("clears to NAME= and reports set / not set without values", () => {
    const out = setEnvValue(base, "BSC_TESTNET_RPC_URL", null);
    expect(out).toContain("\nBSC_TESTNET_RPC_URL=\n");
    expect(isEnvSet(out, "BSC_TESTNET_RPC_URL")).toBe(false);
    expect(isEnvSet(base, "BSC_TESTNET_RPC_URL")).toBe(true);
    expect(isEnvSet(base, "CMC_API_KEY")).toBe(false); // only commented
    expect(isEnvSet('X=""\n', "X")).toBe(false);
    expect(setEnvValue("A=1\n", "CMC_API_KEY", null)).toBe("A=1\n"); // clearing a missing name is a no-op
  });

  it("does not match a name that is only a prefix of another", () => {
    expect(setEnvValue("CMC_API_KEY_OLD=1\n", "CMC_API_KEY", "v")).toBe("CMC_API_KEY_OLD=1\nCMC_API_KEY=v\n");
  });

  it("refuses newline injection at the edit layer too", () => {
    expect(() => setEnvValue(base, "CMC_API_KEY", "a\nPRIVATE_KEY=0xevil")).toThrow();
  });
});

describe("value validation", () => {
  it("accepts well-formed values and trims surrounding spaces", () => {
    expect(validateSecretValue(spec("INSPECTOR_PRIVATE_KEY"), `  ${KEY} `)).toBe(KEY);
    expect(validateSecretValue(spec("PINATA_JWT"), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl")).toMatch(/^eyJ/);
    expect(validateSecretValue(spec("CMC_API_KEY"), "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c")).toBeTruthy();
    expect(validateSecretValue(spec("BSC_TESTNET_RPC_URL"), "https://bsc-testnet.example/v1/abc?key=1&x=2")).toBeTruthy();
    expect(validateSecretValue(spec("ANTHROPIC_API_KEY"), `sk-ant-api03-${"x".repeat(40)}`)).toBeTruthy();
    expect(validateSecretValue(spec("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"), "0123456789abcdef0123456789ABCDEF")).toBeTruthy();
    expect(validateSecretValue(spec("COURNOT_API_KEY"), "ck_live_abc-DEF_123")).toBeTruthy();
    expect(validateSecretValue(spec("COURNOT_API_BASE"), "https://dev-interface.cournot.ai")).toBeTruthy();
  });

  it("rejects newlines, quotes, $, #, spaces, bad formats and over-long values, without echoing the value", () => {
    const secret = "SUPERSECRETVALUE-do-not-echo";
    const cases: [string, string][] = [
      ["CMC_API_KEY", "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c\nPRIVATE_KEY=0x1"],
      ["CMC_API_KEY", "abc\r"],
      ["LIVING_BRAIN_API_KEY", `${secret} more`],
      ["LIVING_BRAIN_API_KEY", `${secret}$HOME`],
      ["LIVING_BRAIN_API_KEY", `${secret}#c`],
      ["LIVING_BRAIN_API_KEY", `"${secret}"`],
      ["INSPECTOR_PRIVATE_KEY", secret],
      ["INSPECTOR_PRIVATE_KEY", "0x1234"],
      ["PINATA_JWT", secret],
      ["CMC_API_KEY", secret],
      ["LIVING_BRAIN_API_KEY", "x".repeat(600)],
      ["LIVING_BRAIN_API_KEY", ""],
      ["LIVING_BRAIN_API_KEY", "   "],
      ["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", `${secret}0123456789abcdef`],
      ["COURNOT_API_KEY", `ck_test_${secret}`],
      ["COURNOT_API_BASE", `https://${secret}.example`],
      ["COURNOT_API_BASE", "http://interface.cournot.ai"],
    ];
    for (const [name, value] of cases) {
      let msg = "";
      try {
        validateSecretValue(spec(name), value);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, `${name} accepted a bad value`).toMatch(/^Invalid value/);
      expect(msg).not.toContain(secret);
    }
    expect(() => validateSecretValue(spec("CMC_API_KEY"), 42)).toThrow(/^Invalid value/);
  });
});

describe("allowlist", () => {
  it("lists every name of the secrets page request, each with a tester, in its group", () => {
    const want: Record<string, string> = {
      CMC_API_KEY: "prices",
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "wallet",
      BSC_TESTNET_RPC_URL: "rpc",
      BSC_MAINNET_RPC_URL: "rpc",
      PINATA_JWT: "storage",
      COURNOT_API_KEY: "sponsors",
      COURNOT_API_BASE: "sponsors",
      LIVING_BRAIN_API_KEY: "sponsors",
      LIVING_BRAIN_BRAIN_ID: "sponsors",
    };
    for (const [name, group] of Object.entries(want)) {
      expect(secretSpec(name)?.group, name).toBe(group);
      expect(isTestable(name), name).toBe(true);
    }
    expect(new Set(SECRETS.map((s) => s.name)).size).toBe(SECRETS.length);
  });

  it("allows only the public WalletConnect id of the NEXT_PUBLIC_ names; it goes to web/.env.local and needs a rebuild", () => {
    expect(SECRETS.filter((s) => s.name.startsWith("NEXT_PUBLIC_")).map((s) => [s.name, s.public])).toEqual([["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", true]]);
    expect(spec("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID").targets).toEqual(["web"]);
    expect(restartUnits(spec("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"))).toEqual([]);
    expect(SECRETS.filter((s) => s.public).every((s) => s.name.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });

  it("refuses other NEXT_PUBLIC_ names and unknown names", () => {
    expect(secretSpec("NEXT_PUBLIC_RPC_URL")).toBeUndefined();
    expect(secretSpec("PATH")).toBeUndefined();
    expect(secretSpec("NODE_OPTIONS")).toBeUndefined();
    expect(secretSpec("SETTINGS_SECRETS_ENABLED")).toBeUndefined();
    expect(secretSpec(undefined)).toBeUndefined();
  });

  it("maps each name to its file(s) and restart units", () => {
    expect(spec("ANTHROPIC_API_KEY").targets).toEqual(["web"]);
    expect([...spec("INSPECTOR_PRIVATE_KEY").targets].sort()).toEqual(["root", "web"]);
    expect(spec("BSCSCAN_API_KEY").targets).toEqual(["root"]);
    expect(restartUnits(spec("CMC_API_KEY"))).toEqual(["keyescrow-web", "keyescrow-web-testnet"]);
    expect(restartUnits(spec("BSC_TESTNET_RPC_URL"))).toEqual(["keyescrow-web-testnet"]);
    expect(restartUnits(spec("CLOUDFLARE_API_TOKEN"))).toEqual([]);
    expect(spec("BSC_MAINNET_RPC_URL").targets).toEqual(["root"]);
    expect(restartUnits(spec("BSC_MAINNET_RPC_URL"))).toEqual([]);
    expect(spec("COURNOT_API_BASE").targets).toEqual(["web"]);
  });
});

describe("on / off", () => {
  it("is off unless SETTINGS_SECRETS_ENABLED=1, and always off on Cloudflare", () => {
    expect(settingsSecretsEnabled({})).toBe(false);
    expect(settingsSecretsEnabled({ SETTINGS_SECRETS_ENABLED: "true" })).toBe(false);
    expect(settingsSecretsEnabled({ SETTINGS_SECRETS_ENABLED: "1" })).toBe(true);
    expect(settingsSecretsEnabled({ SETTINGS_SECRETS_ENABLED: "1", CF_PAGES: "1" })).toBe(false);
    expect(settingsSecretsEnabled({ SETTINGS_SECRETS_ENABLED: "1", WORKERS_CI: "1" })).toBe(false);
  });

  it("fails a Cloudflare build that has the page switched on", () => {
    expect(() => assertSecretsPageBuildAllowed({ SETTINGS_SECRETS_ENABLED: "1", WORKERS_CI: "1" })).toThrow(/local-only/);
    expect(() => assertSecretsPageBuildAllowed({ SETTINGS_SECRETS_ENABLED: "1", CF_PAGES: "1" })).toThrow();
    expect(() => assertSecretsPageBuildAllowed({ CF_PAGES: "1" })).not.toThrow();
    expect(() => assertSecretsPageBuildAllowed({ SETTINGS_SECRETS_ENABLED: "1" })).not.toThrow();
  });
});

const req = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(url, { ...init, headers: { host: new URL(url).host, "x-forwarded-for": "127.0.0.1", ...init.headers } });

describe("network and origin guard", () => {
  it("allows only loopback and the Tailscale CGNAT range", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "100.64.0.1", "100.96.145.38", "100.127.255.255", "::ffff:100.100.1.1"]) {
      expect(isAllowedIp(ip), ip).toBe(true);
    }
    for (const ip of ["10.0.0.1", "192.168.1.5", "100.63.255.255", "100.128.0.1", "8.8.8.8", "127.0.0.2", "", "1.2.3.4.5", "999.1.1.1"]) {
      expect(isAllowedIp(ip), ip).toBe(false);
    }
  });

  it("allows only local, tailnet and configured hostnames", () => {
    expect(isAllowedHost("127.0.0.1:3000")).toBe(true);
    expect(isAllowedHost("100.96.145.38:3001")).toBe(true);
    expect(isAllowedHost("[::1]:3000")).toBe(true);
    expect(isAllowedHost("paseo-box.tail1234.ts.net:3000")).toBe(true);
    expect(isAllowedHost("keyescrow.example.com")).toBe(false);
    expect(isAllowedHost("keyescrow.example.com", { SETTINGS_SECRETS_HOSTS: "keyescrow.example.com" })).toBe(true);
    expect(isAllowedHost(null)).toBe(false);
  });

  it("checks client IP, Host, proxy headers, Origin and content type", () => {
    const u = "http://127.0.0.1:3000/api/settings/secrets";
    const ok = { origin: "http://127.0.0.1:3000", "content-type": "application/json" };
    expect(checkRequest(req(u, { method: "POST", headers: ok }), {}, true)).toBeNull();
    expect(checkRequest(req(u), {}, false)).toBeNull();
    expect(checkRequest(req(u, { headers: { "x-forwarded-for": "8.8.8.8" } }), {}, false)?.status).toBe(403);
    expect(checkRequest(req(u, { headers: { "x-forwarded-for": "8.8.8.8, 127.0.0.1" } }), {}, false)?.status).toBe(403);
    expect(checkRequest(req(u, { headers: { "cf-connecting-ip": "127.0.0.1" } }), {}, false)?.status).toBe(403);
    expect(checkRequest(req(u, { headers: { host: "evil.example" } }), {}, false)?.status).toBe(403);
    expect(checkRequest(req(u, { method: "POST", headers: { "content-type": "application/json" } }), {}, true)?.status).toBe(403); // no Origin
    expect(checkRequest(req(u, { method: "POST", headers: { ...ok, origin: "http://evil.example" } }), {}, true)?.status).toBe(403);
    expect(checkRequest(req(u, { method: "POST", headers: { ...ok, "sec-fetch-site": "cross-site" } }), {}, true)?.status).toBe(403);
    expect(checkRequest(req(u, { method: "POST", headers: { origin: ok.origin, "content-type": "text/plain" } }), {}, true)?.status).toBe(415);
  });

  it("rate-limits per key in a sliding window", () => {
    const l = new RateLimiter(2, 1000);
    expect(l.take("a", 0)).toBe(true);
    expect(l.take("a", 10)).toBe(true);
    expect(l.take("a", 20)).toBe(false);
    expect(l.take("b", 20)).toBe(true);
    expect(l.take("a", 1500)).toBe(true);
  });
});

describe("passcode and session", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "secrets-pass-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("creates the passcode once with mode 600 and keeps it", async () => {
    const file = path.join(dir, "secrets", "settings-passcode");
    const a = await ensurePasscode(file);
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await ensurePasscode(file)).toBe(a);
  });

  it("checks the passcode and signs a short, httpOnly SameSite=Strict session", () => {
    expect(passcodeMatches("abc", "abc")).toBe(true);
    expect(passcodeMatches(" abc ", "abc")).toBe(true);
    expect(passcodeMatches("abd", "abc")).toBe(false);
    expect(passcodeMatches(undefined, "abc")).toBe(false);
    const now = 1_800_000_000_000;
    const t = createSessionToken("pass", now);
    expect(sessionValid(t, "pass", now + 1000)).toBe(true);
    expect(sessionValid(t, "pass", now + SESSION_TTL_MS + 1)).toBe(false); // expired
    expect(sessionValid(t, "other", now)).toBe(false); // passcode rotated
    expect(sessionValid(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "pass", now)).toBe(false);
    expect(sessionValid(`${now + 10 * SESSION_TTL_MS}.${t.split(".")[1]}`, "pass", now)).toBe(false);
    const c = sessionCookie(t, false);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Max-Age=900/);
    expect(c).not.toMatch(/pass/);
    expect(readCookie(`a=1; ${c.split(";")[0]}`)).toBe(t);
  });
});

describe("service and routes (temp env files only)", () => {
  let dir: string;
  let env: Record<string, string>;
  const saved = { ...process.env };
  const rootText = "# root\nBSC_TESTNET_RPC_URL=https://old.example\nDEPLOYER_ADDRESS=0x0000000000000000000000000000000000000001\n";
  const webText = "# web\nNEXT_PUBLIC_DEV_ACCOUNTS=1\nCMC_API_KEY=\n";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "secrets-svc-"));
    await writeFile(path.join(dir, ".env"), rootText, { mode: 0o600 });
    await writeFile(path.join(dir, "web.env.local"), webText, { mode: 0o600 });
    env = {
      SETTINGS_SECRETS_ENABLED: "1",
      SECRETS_ENV_FILE: path.join(dir, ".env"),
      SECRETS_WEB_ENV_FILE: path.join(dir, "web.env.local"),
      SETTINGS_SECRETS_STATE_DIR: path.join(dir, ".orca"),
      SETTINGS_SECRETS_RESTART: "0",
    };
    Object.assign(process.env, env);
    (globalThis as Record<string, unknown>).__keyescrowSecretsLimiters = undefined;
  });
  afterEach(async () => {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
    await rm(dir, { recursive: true, force: true });
  });

  it("writes to each target file atomically, mode 600, with backups (last 10) and a value-free audit line", async () => {
    const cfg = secretsConfig(env);
    await writeSecret(cfg, "INSPECTOR_PRIVATE_KEY", KEY, "100.96.1.2");
    const root = await readFile(cfg.files.root, "utf8");
    const web = await readFile(cfg.files.web, "utf8");
    expect(root).toBe(`${rootText}INSPECTOR_PRIVATE_KEY=${KEY}\n`);
    expect(web).toBe(`${webText}INSPECTOR_PRIVATE_KEY=${KEY}\n`);
    expect((await stat(cfg.files.root)).mode & 0o777).toBe(0o600);
    const backups = await readdir(path.join(cfg.stateDir, "backup", "env"));
    expect(backups.filter((f) => f.startsWith("root.env.")).length).toBe(1);
    expect(backups.filter((f) => f.startsWith("web.env.local.")).length).toBe(1);
    for (const b of backups) expect((await stat(path.join(cfg.stateDir, "backup", "env", b))).mode & 0o777).toBe(0o600);
    const log = await readFile(auditFile(cfg), "utf8");
    expect(log).toMatch(/\tINSPECTOR_PRIVATE_KEY\tset\tweb,root\t100\.96\.1\.2\n$/);
    expect(log).not.toContain(KEY);
    expect((await stat(auditFile(cfg))).mode & 0o777).toBe(0o600);

    const status = await listSecrets(cfg);
    const insp = status.find((s) => s.name === "INSPECTOR_PRIVATE_KEY")!;
    expect(insp.set).toBe(true);
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(status.find((s) => s.name === "CMC_API_KEY")!.set).toBe(false);

    await writeSecret(cfg, "INSPECTOR_PRIVATE_KEY", null, "127.0.0.1");
    expect(await readFile(cfg.files.root, "utf8")).toBe(`${rootText}INSPECTOR_PRIVATE_KEY=\n`);
    expect((await listSecrets(cfg)).find((s) => s.name === "INSPECTOR_PRIVATE_KEY")!.set).toBe(false);
    expect(await readFile(auditFile(cfg), "utf8")).toMatch(/\tcleared\t/);

    for (let i = 0; i < 12; i++) await writeSecret(cfg, "BSCSCAN_API_KEY", `KEY${i}ABCDEFGH`, null, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    const after = (await readdir(path.join(cfg.stateDir, "backup", "env"))).filter((f) => f.startsWith("root.env."));
    expect(after.length).toBe(10);
  });

  it("refuses non-allowlisted and NEXT_PUBLIC_ names and leaves the files untouched", async () => {
    const cfg = secretsConfig(env);
    await expect(writeSecret(cfg, "NEXT_PUBLIC_DEV_ACCOUNTS", "0", null)).rejects.toThrow("Unknown name.");
    await expect(writeSecret(cfg, "PATH", "/tmp", null)).rejects.toThrow("Unknown name.");
    await expect(writeSecret(cfg, "CMC_API_KEY", "x\nNEXT_PUBLIC_DEV_ACCOUNTS=1", null)).rejects.toThrow(/^Invalid value/);
    expect(await readFile(cfg.files.root, "utf8")).toBe(rootText);
    expect(await readFile(cfg.files.web, "utf8")).toBe(webText);
  });

  it("restarts allowlisted units only", () => {
    const calls: string[] = [];
    const sys: Systemctl = { show: async () => ({}), restart: (u) => calls.push(u) };
    const cfg = { ...secretsConfig(env), restart: true };
    expect(restartUnit(cfg, "keyescrow-web", sys)).toBe("keyescrow-web");
    expect(() => restartUnit(cfg, "ssh", sys)).toThrow();
    expect(() => restartUnit(cfg, "keyescrow-web; reboot", sys)).toThrow();
    expect(() => restartUnit(secretsConfig(env), "keyescrow-web", sys)).toThrow(); // SETTINGS_SECRETS_RESTART=0
    expect(calls).toEqual(["keyescrow-web"]);
  });

  const origin = "http://127.0.0.1:3000";
  const api = `${origin}/api/settings/secrets`;
  const post = (url: string, body: unknown, cookie?: string) =>
    req(url, { method: "POST", body: JSON.stringify(body), headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) } });

  // A page load from this machine, as `next start` sees it.
  const pageHeaders = { host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1", "sec-fetch-site": "none" };

  it("the page renders only when on and the request is local: same checks as the API", () => {
    expect(secretsPageAllowed(new Headers(pageHeaders), process.env)).toBe(true);
    expect(secretsPageAllowed(new Headers({ ...pageHeaders, host: "keyescrow.example.com" }), process.env)).toBe(false);
    expect(secretsPageAllowed(new Headers({ ...pageHeaders, "x-forwarded-for": "8.8.8.8" }), process.env)).toBe(false);
    expect(secretsPageAllowed(new Headers({ ...pageHeaders, "cf-connecting-ip": "1.2.3.4" }), process.env)).toBe(false);
    expect(secretsPageAllowed(new Headers({ ...pageHeaders, "sec-fetch-site": "cross-site" }), process.env)).toBe(false);
    expect(secretsPageAllowed(new Headers(pageHeaders), { ...process.env, WORKERS_CI: "1" })).toBe(false);
  });

  it("security headers on the page and the API (next.config.ts)", async () => {
    const rules = await nextConfig.headers!();
    for (const source of ["/settings/secrets", "/api/settings/:path*"]) {
      const rule = rules.find((r) => r.source === source)!;
      expect(Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))).toMatchObject({ "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    }
  });

  it("with no proxy in front, every write route guards itself: 403 through a CDN or from another site", async () => {
    const routes = [
      [POST, api, { name: "CMC_API_KEY", value: "x" }],
      [SESSION_POST, `${api}/session`, { passcode: "x" }],
      [RESTART_POST, `${api}/restart`, { unit: "keyescrow-web" }],
      [TEST_POST, `${api}/test`, { name: "CMC_API_KEY" }],
    ] as const;
    for (const [handler, url, body] of routes) {
      const viaCdn = req(url, { method: "POST", body: JSON.stringify(body), headers: { origin, "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" } });
      expect((await handler(viaCdn)).status, url).toBe(403);
      const crossSite = req(url, { method: "POST", body: JSON.stringify(body), headers: { origin: "http://evil.example", "content-type": "application/json" } });
      expect((await handler(crossSite)).status, url).toBe(403);
    }
  });

  it("answers 404 everywhere when disabled (routes and the page)", async () => {
    delete process.env.SETTINGS_SECRETS_ENABLED;
    expect((await GET(req(api))).status).toBe(404);
    expect((await POST(post(api, { name: "CMC_API_KEY", value: "x" }))).status).toBe(404);
    expect((await SESSION_POST(post(`${api}/session`, { passcode: "x" }))).status).toBe(404);
    expect((await RESTART_POST(post(`${api}/restart`, { unit: "keyescrow-web" }))).status).toBe(404);
    expect((await TEST_POST(post(`${api}/test`, { name: "CMC_API_KEY" }))).status).toBe(404);
    expect(secretsPageAllowed(new Headers(pageHeaders), process.env)).toBe(false);
    process.env.SETTINGS_SECRETS_ENABLED = "1";
    process.env.WORKERS_CI = "1";
    expect((await GET(req(api))).status).toBe(404);
    delete process.env.WORKERS_CI;
  });

  it("locks without the passcode, unlocks with it, and never returns the value", async () => {
    expect((await GET(req(api))).status).toBe(401);
    expect((await POST(post(api, { name: "CMC_API_KEY", value: "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c" }))).status).toBe(401);
    expect(await readFile(env.SECRETS_WEB_ENV_FILE, "utf8")).toBe(webText);

    const wrong = await SESSION_POST(post(`${api}/session`, { passcode: "nope" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const passcode = (await readFile(passcodeFile(secretsConfig(env)), "utf8")).trim();
    const ok = await SESSION_POST(post(`${api}/session`, { passcode }));
    expect(ok.status).toBe(200);
    const okBody = await ok.text();
    expect(okBody).not.toContain(passcode);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];

    const value = "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c";
    const saved = await POST(post(api, { name: "CMC_API_KEY", value }, cookie));
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toMatch(/no-store/);
    const savedBody = await saved.text();
    expect(savedBody).not.toContain(value);
    expect(JSON.parse(savedBody)).toMatchObject({ name: "CMC_API_KEY", set: true });
    expect(await readFile(env.SECRETS_WEB_ENV_FILE, "utf8")).toBe(webText.replace("CMC_API_KEY=\n", `CMC_API_KEY=${value}\n`));

    const listed = await GET(req(api, { headers: { cookie } }));
    const text = await listed.text();
    expect(listed.status).toBe(200);
    expect(text).not.toContain(value);
    expect(JSON.parse(text).secrets.find((s: { name: string }) => s.name === "CMC_API_KEY").set).toBe(true);

    const bad = await POST(post(api, { name: "CMC_API_KEY", value: "leak-me\nX=1" }, cookie));
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("leak-me");
    expect((await POST(post(api, { name: "NEXT_PUBLIC_CHAIN_ID", value: "97" }, cookie))).status).toBe(400);
    const forged = post(api, { name: "CMC_API_KEY", action: "clear" }, cookie);
    forged.headers.set("origin", "http://evil.example");
    expect((await POST(forged)).status).toBe(403);
    expect((await RESTART_POST(post(`${api}/restart`, { unit: "keyescrow-web" }, cookie))).status).toBe(400); // restarts off here
  });

  it("rate-limits passcode attempts", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await SESSION_POST(post(`${api}/session`, { passcode: `guess${i}` }))).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });
});

it("writeEnvFileAtomic creates a missing file with mode 600", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "secrets-new-"));
  const f = path.join(dir, "sub", ".env");
  await writeEnvFileAtomic(f, "A=1\n", { backupDir: path.join(dir, "bk"), label: "x" });
  expect(await readFile(f, "utf8")).toBe("A=1\n");
  expect((await stat(f)).mode & 0o777).toBe(0o600);
  expect((await readdir(path.dirname(f))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  await rm(dir, { recursive: true, force: true });
});
