import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { testSecret, type TestCtx } from "@/lib/server/secrets/testers";
import { auditFile, passcodeFile, secretsConfig, testStoredOrTyped } from "@/lib/server/secrets/service";
import { SECRETS } from "@/lib/server/secrets/registry";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

/** A fetch stub: answers by URL with a status and JSON body, records every call. `"timeout"` throws a TimeoutError. */
type Answer = { status: number; body: unknown } | "timeout" | "network";
function stubFetch(route: (url: string, init: RequestInit) => Answer) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const a = route(url, init);
    if (a === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (a === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

const ctx = (fetchImpl: typeof fetch, extra: Partial<TestCtx> = {}): TestCtx => ({ fetch: fetchImpl, stored: () => undefined, ...extra });
const KEY = `0x${"11".repeat(32)}`;
const ADDRESS = privateKeyToAccount(KEY as `0x${string}`).address;

/** Runs the test and checks that neither the reason nor anything else in the result carries the value. */
async function run(name: string, value: string, c: TestCtx) {
  const r = await testSecret(name, value, c);
  expect(JSON.stringify(r)).not.toContain(value);
  return r;
}

const cases: {
  name: string;
  value: string;
  host: string;
  ok: Answer;
  bad: Answer;
  validRe: RegExp;
  invalidRe: RegExp;
  timeout: "untestable" | "invalid";
}[] = [
  {
    name: "ANTHROPIC_API_KEY",
    value: `sk-ant-api03-${"a".repeat(40)}`,
    host: "api.anthropic.com/v1/models",
    ok: { status: 200, body: { data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }] } },
    bad: { status: 401, body: { type: "error", error: { type: "authentication_error" } } },
    validRe: /^Valid: 2 models listed$/,
    invalidRe: /^Invalid: 401 unauthorized$/,
    timeout: "untestable",
  },
  {
    name: "CMC_API_KEY",
    value: "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c",
    host: "pro-api.coinmarketcap.com/v1/key/info",
    ok: { status: 200, body: { data: { usage: { current_month: { credits_left: 9876 } } } } },
    bad: { status: 401, body: { status: { error_code: 1001, error_message: "This API Key is invalid." } } },
    validRe: /^Valid: 9876 credits left this month$/,
    invalidRe: /^Invalid: 401 unauthorized$/,
    timeout: "untestable",
  },
  {
    name: "CLOUDFLARE_API_TOKEN",
    value: "cf-token-abcdefghijklmnopqrstuvwxyz0123456789",
    host: "api.cloudflare.com/client/v4/user/tokens/verify",
    ok: { status: 200, body: { success: true, result: { status: "active" } } },
    bad: { status: 401, body: { success: false, errors: [{ code: 1000, message: "Invalid API Token" }] } },
    validRe: /^Valid: token active$/,
    invalidRe: /^Invalid: 401 unauthorized$/,
    timeout: "untestable",
  },
  {
    name: "PINATA_JWT",
    value: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    host: "api.pinata.cloud/data/testAuthentication",
    ok: { status: 200, body: { message: "Congratulations! You are communicating with the Pinata API!" } },
    bad: { status: 401, body: { error: { reason: "INVALID_CREDENTIALS" } } },
    validRe: /^Valid: Pinata authentication OK$/,
    invalidRe: /^Invalid: 401 unauthorized$/,
    timeout: "untestable",
  },
  {
    name: "BSC_TESTNET_RPC_URL",
    value: "https://bsc-testnet.example/v1/SECRETRPCKEY123",
    host: "bsc-testnet.example",
    ok: { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x61" } },
    bad: { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x38" } },
    validRe: /^Valid: chainId 97$/,
    invalidRe: /^Invalid: chainId 56, expected 97$/,
    timeout: "invalid",
  },
  {
    name: "BSC_MAINNET_RPC_URL",
    value: "https://bsc-mainnet.example/v1/SECRETMAINNETKEY1",
    host: "bsc-mainnet.example",
    ok: { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x38" } },
    bad: { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x61" } },
    validRe: /^Valid: chainId 56$/,
    invalidRe: /^Invalid: chainId 97, expected 56$/,
    timeout: "invalid",
  },
  {
    name: "LIVING_BRAIN_API_KEY",
    value: "lb_live_SECRETBRAINKEY0123456789",
    host: "api.livingbrain.com/v1/brains",
    ok: { status: 200, body: [{ id: "brain-1", name: "KeyEscrow scooters" }, { id: "brain-2" }] },
    bad: { status: 401, body: { message: "invalid api key" } },
    validRe: /^Valid: 2 brains listed$/,
    invalidRe: /^Invalid: 401 unauthorized$/,
    timeout: "untestable",
  },
  {
    name: "ATLAS_RPC_URL",
    value: "https://rpc.example/key/SECRETATLASKEY99",
    host: "rpc.example",
    ok: { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x61" } },
    bad: { status: 401, body: { error: "unauthorized" } },
    validRe: /^Valid: chainId 97$/,
    invalidRe: /^Invalid: the RPC answered 401 unauthorized$/,
    timeout: "invalid",
  },
  {
    name: "GREENFIELD_RPC_URL",
    value: "https://gnfd-testnet.example/SECRETGF77",
    host: "gnfd-testnet.example/SECRETGF77/status",
    ok: { status: 200, body: { result: { node_info: { network: "greenfield_5600-1" } } } },
    bad: { status: 200, body: { result: { node_info: { network: "cosmoshub-4" } } } },
    validRe: /^Valid: greenfield_5600-1$/,
    invalidRe: /^Invalid: not a Greenfield node$/,
    timeout: "invalid",
  },
];

describe.each(cases)("$name tester", (c) => {
  it("valid: one call to the free endpoint, value never in the result", async () => {
    const s = stubFetch(() => c.ok);
    const r = await run(c.name, c.value, ctx(s.fn));
    expect(r.status).toBe("valid");
    expect(r.reason).toMatch(c.validRe);
    expect(s.calls.length).toBe(1);
    expect(s.calls[0].url).toContain(c.host);
    expect(s.calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(s.calls[0].init.redirect).toBe("manual");
  });

  it("invalid", async () => {
    const r = await run(c.name, c.value, ctx(stubFetch(() => c.bad).fn));
    expect(r.status).toBe("invalid");
    expect(r.reason).toMatch(c.invalidRe);
  });

  it("timeout", async () => {
    const r = await run(c.name, c.value, ctx(stubFetch(() => "timeout").fn));
    expect(r.status).toBe(c.timeout);
    expect(r.reason).toMatch(/10 s/);
  });

  it("an answer that echoes the value does not leak it", async () => {
    const r = await run(c.name, c.value, ctx(stubFetch(() => ({ status: 500, body: { error: c.value, message: c.value } })).fn));
    expect(["untestable", "invalid"]).toContain(r.status);
  });
});

describe("BSCSCAN_API_KEY (Etherscan V2, chainid 97 eth_blockNumber)", () => {
  const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678";
  it("valid on chain 97", async () => {
    const s = stubFetch(() => ({ status: 200, body: { jsonrpc: "2.0", id: 83, result: "0x3a1b2c" } }));
    const r = await run("BSCSCAN_API_KEY", value, ctx(s.fn));
    expect(r).toEqual({ status: "valid", reason: "Valid: chain 97 block number returned" });
    expect(s.calls[0].url).toMatch(/api\.etherscan\.io\/v2\/api\?chainid=97&module=proxy&action=eth_blockNumber/);
  });
  it("invalid key", async () => {
    const r = await run("BSCSCAN_API_KEY", value, ctx(stubFetch(() => ({ status: 200, body: { status: "0", message: "NOTOK", result: "Invalid API Key (#err2)|" } })).fn));
    expect(r).toEqual({ status: "invalid", reason: "Invalid: Etherscan says invalid API key" });
  });
  it("valid key whose free plan does not cover chain 97 (falls back to a free chain 1 call)", async () => {
    const s = stubFetch((url) =>
      url.includes("chainid=97")
        ? { status: 200, body: { status: "0", message: "NOTOK", result: "Free API access is not supported for this chain. Please upgrade your api plan." } }
        : { status: 200, body: { jsonrpc: "2.0", id: 83, result: "0x1" } },
    );
    const r = await run("BSCSCAN_API_KEY", value, ctx(s.fn));
    expect(r).toEqual({ status: "valid", reason: "Valid: key works; chain 97 needs a paid Etherscan plan" });
    expect(s.calls.length).toBe(2);
  });
  it("timeout", async () => {
    expect((await run("BSCSCAN_API_KEY", value, ctx(stubFetch(() => "timeout").fn))).status).toBe("untestable");
  });
});

describe("CLOUDFLARE_ACCOUNT_ID (needs the stored token)", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const token = "stored-cloudflare-token-0123456789";
  it("can't test without a stored token, and makes no call", async () => {
    const s = stubFetch(() => ({ status: 200, body: {} }));
    expect((await run("CLOUDFLARE_ACCOUNT_ID", id, ctx(s.fn))).reason).toBe("Can't test: save CLOUDFLARE_API_TOKEN first");
    expect(s.calls.length).toBe(0);
  });
  it("valid / invalid / timeout with the stored token, which never shows up either", async () => {
    const stored = (n: string) => (n === "CLOUDFLARE_API_TOKEN" ? token : undefined);
    const ok = stubFetch(() => ({ status: 200, body: { success: true, result: { id, name: "Acme" } } }));
    const r = await run("CLOUDFLARE_ACCOUNT_ID", id, ctx(ok.fn, { stored }));
    expect(r).toEqual({ status: "valid", reason: "Valid: account found with the stored token" });
    expect(ok.calls[0].url).toContain(`api.cloudflare.com/client/v4/accounts/${id}`);
    expect((ok.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
    expect(JSON.stringify(r)).not.toContain(token);
    expect((await run("CLOUDFLARE_ACCOUNT_ID", id, ctx(stubFetch(() => ({ status: 403, body: {} })).fn, { stored }))).status).toBe("invalid");
    expect((await run("CLOUDFLARE_ACCOUNT_ID", id, ctx(stubFetch(() => "timeout").fn, { stored }))).status).toBe("untestable");
  });
});

describe("local key checks (no network)", () => {
  const noNet = stubFetch(() => {
    throw new Error("no network expected");
  });
  it("INSPECTOR_PRIVATE_KEY: derives the address and compares it with the registered signer", async () => {
    expect(await run("INSPECTOR_PRIVATE_KEY", KEY, ctx(noNet.fn))).toEqual({
      status: "valid",
      reason: `Valid key: address ${ADDRESS} (no registered signer to compare with)`,
    });
    expect(await run("INSPECTOR_PRIVATE_KEY", KEY, ctx(noNet.fn, { agentReportSigner: ADDRESS.toLowerCase() }))).toEqual({
      status: "valid",
      reason: `Valid: ${ADDRESS} is the registered report signer`,
    });
    const other = await run("INSPECTOR_PRIVATE_KEY", KEY, ctx(noNet.fn, { stored: () => "0x000000000000000000000000000000000000dEaD" }));
    expect(other.status).toBe("invalid");
    expect((await run("INSPECTOR_PRIVATE_KEY", `0x${"00".repeat(32)}`, ctx(noNet.fn))).status).toBe("invalid");
  });
  it("GREENFIELD_PRIVATE_KEY shows the address only", async () => {
    expect(await run("GREENFIELD_PRIVATE_KEY", KEY, ctx(noNet.fn))).toEqual({ status: "valid", reason: `Valid key: address ${ADDRESS}` });
  });
  it("GREENFIELD_CHAIN_ID compares with the stored RPC's network", async () => {
    const s = stubFetch(() => ({ status: 200, body: { result: { node_info: { network: "greenfield_5600-1" } } } }));
    const stored = (n: string) => (n === "GREENFIELD_RPC_URL" ? "https://gf.example" : undefined);
    expect((await run("GREENFIELD_CHAIN_ID", "5600", ctx(s.fn, { stored }))).status).toBe("valid");
    expect((await run("GREENFIELD_CHAIN_ID", "1017", ctx(s.fn, { stored }))).status).toBe("invalid");
    expect((await run("GREENFIELD_CHAIN_ID", "5600", ctx(s.fn))).status).toBe("untestable");
    expect(noNet.calls.length).toBe(0);
  });
});

describe("RPC URLs: wrong chain, 401, unreachable", () => {
  it.each([
    ["BSC_TESTNET_RPC_URL", "0x38", "Invalid: chainId 56, expected 97"],
    ["BSC_MAINNET_RPC_URL", "0x61", "Invalid: chainId 97, expected 56"],
  ])("%s on the other chain is invalid", async (name, chain, reason) => {
    expect(await run(name, "https://rpc.example/k/SECRET42", ctx(stubFetch(() => ({ status: 200, body: { result: chain } })).fn))).toEqual({ status: "invalid", reason });
  });
  it.each(["BSC_TESTNET_RPC_URL", "BSC_MAINNET_RPC_URL"])("%s: 401 and a bad URL are invalid", async (name) => {
    const r401 = await run(name, "https://rpc.example/k/SECRET42", ctx(stubFetch(() => ({ status: 401, body: {} })).fn));
    expect(r401).toEqual({ status: "invalid", reason: "Invalid: the RPC answered 401 unauthorized" });
    const bad = await run(name, "not-a-url-SECRET42", ctx(stubFetch(() => "network").fn));
    expect(bad).toEqual({ status: "invalid", reason: "Invalid: the RPC could not be reached" });
  });
});

describe("format checks (no free key check): WalletConnect id, Cournot key and base", () => {
  const noNet = () => stubFetch(() => {
    throw new Error("no network expected");
  });
  it("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: 32 hex characters, no call", async () => {
    const s = noNet();
    expect((await run("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "0123456789abcdef0123456789abcdef", ctx(s.fn))).status).toBe("valid");
    expect(await run("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "0123456789abcdef0123456789abcdeg", ctx(s.fn))).toEqual({ status: "invalid", reason: "Invalid: expected 32 hex characters" });
    expect(await run("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "0123456789abcdef", ctx(s.fn))).toEqual({ status: "invalid", reason: "Invalid: expected 32 hex characters" });
    expect(s.calls.length).toBe(0);
  });
  it("COURNOT_API_KEY: a ck_live_ key as our client reads it, no call", async () => {
    const s = noNet();
    expect(await run("COURNOT_API_KEY", "ck_live_abcdefgh1234", ctx(s.fn))).toEqual({ status: "valid", reason: "Valid format: a ck_live_ key (no free Cournot key check)" });
    expect((await run("COURNOT_API_KEY", "ck_test_abcdefgh1234", ctx(s.fn))).status).toBe("invalid");
    expect((await run("COURNOT_API_KEY", "sk-SECRET123456789", ctx(s.fn))).status).toBe("invalid");
    expect(s.calls.length).toBe(0);
  });
  it("COURNOT_API_BASE: only the two bases our client allows (no call otherwise); any HTTP answer below 500 is valid", async () => {
    const s = noNet();
    for (const bad of ["https://evil.example", "http://interface.cournot.ai", "https://interface.cournot.ai.evil.example"]) {
      expect((await run("COURNOT_API_BASE", bad, ctx(s.fn))).status, bad).toBe("invalid");
    }
    expect(s.calls.length).toBe(0);
    const ok = stubFetch(() => ({ status: 200, body: {} }));
    expect(await run("COURNOT_API_BASE", "https://interface.cournot.ai", ctx(ok.fn))).toEqual({ status: "valid", reason: "Valid: answers HTTP 200" });
    expect(ok.calls[0].url).toBe("https://interface.cournot.ai");
    expect(ok.calls[0].init.redirect).toBe("manual");
    expect((await run("COURNOT_API_BASE", "https://interface.cournot.ai", ctx(stubFetch(() => "timeout").fn))).status).toBe("untestable");
    const r404 = stubFetch(() => ({ status: 404, body: {} }));
    expect(await run("COURNOT_API_BASE", "https://dev-interface.cournot.ai/", ctx(r404.fn))).toEqual({ status: "valid", reason: "Valid: answers 404 not found" });
    expect(r404.calls[0].init.method ?? "GET").toBe("GET");
    expect((await run("COURNOT_API_BASE", "https://interface.cournot.ai", ctx(stubFetch(() => ({ status: 503, body: {} })).fn))).status).toBe("untestable");
  });
});

describe("Living Brain: key and brain id", () => {
  const key = "lb_live_STOREDKEY0123456789";
  const subject = "3f1c2b8e-9d4a-4c7b-8e2f-0a1b2c3d4e5f";
  const stored = (n: string) => (n === "LIVING_BRAIN_API_KEY" ? key : n === "LIVING_BRAIN_SUBJECT_ID" ? subject : undefined);
  it("the key test sends x-api-key and the stored x-subject-id; 403 is invalid", async () => {
    const s = stubFetch(() => ({ status: 200, body: { data: [{ id: "b" }] } }));
    expect(await run("LIVING_BRAIN_API_KEY", "lb_typed_KEY0123456789", ctx(s.fn, { stored }))).toEqual({ status: "valid", reason: "Valid: 1 brain listed" });
    expect(s.calls[0].init.headers).toEqual({ "x-api-key": "lb_typed_KEY0123456789", "x-subject-id": subject });
    expect((await run("LIVING_BRAIN_API_KEY", "lb_typed_KEY0123456789", ctx(stubFetch(() => ({ status: 403, body: {} })).fn))).status).toBe("invalid");
  });
  it("brain id without a stored key: format check only, no call", async () => {
    const s = stubFetch(() => ({ status: 200, body: {} }));
    expect((await run("LIVING_BRAIN_BRAIN_ID", "brain_0123456789", ctx(s.fn))).status).toBe("valid");
    expect((await run("LIVING_BRAIN_BRAIN_ID", "x", ctx(s.fn))).status).toBe("invalid");
    expect(s.calls.length).toBe(0);
  });
  it("brain id with the stored key: found / not found / bad stored key / timeout; the key never shows up", async () => {
    const ok = stubFetch(() => ({ status: 200, body: { id: "brain_0123456789" } }));
    const r = await run("LIVING_BRAIN_BRAIN_ID", "brain_0123456789", ctx(ok.fn, { stored }));
    expect(r).toEqual({ status: "valid", reason: "Valid: brain found with the stored key" });
    expect(ok.calls[0].url).toContain("api.livingbrain.com/v1/brains/brain_0123456789");
    expect((ok.calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe(key);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(await run("LIVING_BRAIN_BRAIN_ID", "brain_0123456789", ctx(stubFetch(() => ({ status: 404, body: {} })).fn, { stored }))).toEqual({
      status: "invalid",
      reason: "Invalid: 404 not found for the stored key",
    });
    expect((await run("LIVING_BRAIN_BRAIN_ID", "brain_0123456789", ctx(stubFetch(() => ({ status: 401, body: {} })).fn, { stored }))).reason).toBe(
      "Can't test: the stored LIVING_BRAIN_API_KEY is not valid",
    );
    expect((await run("LIVING_BRAIN_BRAIN_ID", "brain_0123456789", ctx(stubFetch(() => "timeout").fn, { stored }))).status).toBe("untestable");
  });
});

describe("names without a free test never call out", () => {
  it.each(["LIVING_BRAIN_SUBJECT_ID", "GREENFIELD_BUCKET", "GREENFIELD_SP_ENDPOINT"])("%s", async (name) => {
    const s = stubFetch(() => ({ status: 200, body: {} }));
    const r = await run(name, "some-value-123456789", ctx(s.fn));
    expect(r.status).toBe("untestable");
    expect(r.reason).toMatch(/^Can't test/);
    expect(s.calls.length).toBe(0);
  });
  it("every allowlisted name has a tester or a can't-test reason", async () => {
    for (const s of SECRETS) {
      const r = await testSecret(s.name, "x", ctx(stubFetch(() => "network").fn));
      expect(r.reason, s.name).not.toBe("Can't test this name");
    }
  });
});

it("routes fixed API hosts through the e2e stub origin only when one is set", async () => {
  const s = stubFetch(() => ({ status: 200, body: { data: [] } }));
  await testSecret("ANTHROPIC_API_KEY", `sk-ant-${"b".repeat(30)}`, ctx(s.fn, { apiOrigin: "http://127.0.0.1:29999" }));
  expect(s.calls[0].url).toBe("http://127.0.0.1:29999/api.anthropic.com/v1/models?limit=100");
});

describe("test route: stored and typed values, audit, rate limit", () => {
  let dir: string;
  const saved = { ...process.env };
  let env: Record<string, string>;
  const realFetch = globalThis.fetch;
  const value = "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c";
  const typed = "c65cdf5e-2cdb-4f9f-8b35-33aa3d4e573d";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "secrets-test-"));
    await writeFile(path.join(dir, ".env"), "INSPECTOR_SIGNER_ADDRESS=\n", { mode: 0o600 });
    await writeFile(path.join(dir, "web.env.local"), `CMC_API_KEY=${value}\n`, { mode: 0o600 });
    await mkdir(path.join(dir, "agent"), { recursive: true });
    env = {
      SETTINGS_SECRETS_ENABLED: "1",
      SECRETS_ENV_FILE: path.join(dir, ".env"),
      SECRETS_WEB_ENV_FILE: path.join(dir, "web.env.local"),
      SETTINGS_SECRETS_STATE_DIR: path.join(dir, ".orca"),
      SETTINGS_SECRETS_RESTART: "0",
      SETTINGS_SECRETS_AGENT_DEPLOYMENT: path.join(dir, "agent", "97.json"),
    };
    Object.assign(process.env, env);
    (globalThis as Record<string, unknown>).__keyescrowSecretsLimiters = undefined;
  });
  afterEach(async () => {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
    globalThis.fetch = realFetch;
    await rm(dir, { recursive: true, force: true });
  });

  it("tests the stored value and a typed one without writing it; audit has name, tested, result only", async () => {
    const cfg = secretsConfig(env);
    const seen: string[] = [];
    const s = stubFetch((_u, init) => {
      seen.push((init.headers as Record<string, string>)["X-CMC_PRO_API_KEY"]);
      return { status: 200, body: { data: { usage: { current_month: { credits_left: 10 } } } } };
    });
    const a = await testStoredOrTyped(cfg, "CMC_API_KEY", undefined, "127.0.0.1", s.fn);
    expect(a).toMatchObject({ name: "CMC_API_KEY", source: "stored", status: "valid" });
    const b = await testStoredOrTyped(cfg, "CMC_API_KEY", typed, "127.0.0.1", s.fn);
    expect(b).toMatchObject({ source: "typed", status: "valid" });
    expect(seen).toEqual([value, typed]);
    expect(await readFile(cfg.files.web, "utf8")).toBe(`CMC_API_KEY=${value}\n`); // typed value not written
    const log = await readFile(auditFile(cfg), "utf8");
    expect(log).toMatch(/\tCMC_API_KEY\ttested\tstored:valid\t127\.0\.0\.1\n/);
    expect(log).toMatch(/\tCMC_API_KEY\ttested\ttyped:valid\t/);
    expect(log).not.toContain(value);
    expect(log).not.toContain(typed);
    const none = await testStoredOrTyped(cfg, "ANTHROPIC_API_KEY", undefined, null, s.fn);
    expect(none.status).toBe("untestable");
    await expect(testStoredOrTyped(cfg, "NEXT_PUBLIC_CHAIN_ID", undefined, null, s.fn)).rejects.toThrow("Unknown name.");
  });

  it("compares the inspector key with agent/deployments/97.json reportSigner", async () => {
    await writeFile(env.SETTINGS_SECRETS_AGENT_DEPLOYMENT, JSON.stringify({ reportSigner: ADDRESS }));
    const r = await testStoredOrTyped(secretsConfig(env), "INSPECTOR_PRIVATE_KEY", KEY, null, stubFetch(() => "network").fn);
    expect(r).toMatchObject({ status: "valid", reason: `Valid: ${ADDRESS} is the registered report signer` });
  });

  it("route: needs the session, validates typed values without echoing, rate-limits at 10 per 5 minutes", async () => {
    const { POST: TEST } = await import("@/app/api/settings/secrets/test/route");
    const { POST: SESSION } = await import("@/app/api/settings/secrets/session/route");
    const origin = "http://127.0.0.1:3000";
    const post = (url: string, body: unknown, cookie?: string) =>
      new Request(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1", origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      });
    const url = `${origin}/api/settings/secrets/test`;
    expect((await TEST(post(url, { name: "CMC_API_KEY" }))).status).toBe(401);
    // passcode file now exists (created by the guard)
    const passcode = (await readFile(passcodeFile(secretsConfig(env)), "utf8")).trim();
    const login = await SESSION(post(`${origin}/api/settings/secrets/session`, { passcode }));
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    globalThis.fetch = stubFetch(() => ({ status: 401, body: { status: { error_code: 1001 } } })).fn;
    const bad = await TEST(post(url, { name: "CMC_API_KEY", value: "leak-me-not-a-uuid" }, cookie));
    const badText = await bad.text();
    expect(bad.status).toBe(200);
    expect(JSON.parse(badText)).toMatchObject({ status: "invalid", source: "typed" });
    expect(badText).not.toContain("leak-me");
    const stored = await TEST(post(url, { name: "CMC_API_KEY" }, cookie));
    const storedText = await stored.text();
    expect(JSON.parse(storedText)).toMatchObject({ status: "invalid", reason: "Invalid: 401 unauthorized" });
    expect(storedText).not.toContain(value);
    expect(stored.headers.get("cache-control")).toMatch(/no-store/);
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) codes.push((await TEST(post(url, { name: "COURNOT_API_KEY" }, cookie))).status);
    expect(codes.filter((c) => c === 429).length).toBe(1); // 2 above + 8 here = 10 allowed, the 11th refused
  });
});
