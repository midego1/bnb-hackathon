import { privateKeyToAccount } from "viem/accounts";
import { matchesFormat } from "./envFile";

/**
 * Key tests of the secrets page: one FREE, read-only call per name (no credits, no writes, 10 s timeout), or a local
 * check where no network is needed. A result is Valid / Invalid / Can't test with a short reason built only from fixed
 * strings, HTTP status codes and harmless fields of the answer (a chain id, a model count, an address). Never the
 * value, never a URL (an RPC URL can carry a key), never a raw response body.
 */

export type TestStatus = "valid" | "invalid" | "untestable";
export type TestResult = { status: TestStatus; reason: string };

export type TestCtx = {
  fetch: typeof fetch;
  /** Another stored value (e.g. the Cloudflare token for the account id test). Read from the env files. */
  stored: (name: string) => string | undefined;
  /** Address the registered agent signs with (agent/deployments/97.json reportSigner), if known. */
  agentReportSigner?: string;
  /** e2e only: http://127.0.0.1:<port> that stands in for every fixed API host (path becomes /<host><path>). */
  apiOrigin?: string;
  timeoutMs?: number;
};

const TIMEOUT_MS = 10_000;
const valid = (reason: string): TestResult => ({ status: "valid", reason });
const invalid = (reason: string): TestResult => ({ status: "invalid", reason });
const untestable = (reason: string): TestResult => ({ status: "untestable", reason });

export const NO_FREE_TEST = "Can't test without spending credits";

class NetError extends Error {
  constructor(readonly timeout: boolean) {
    super(timeout ? "timeout" : "network");
  }
}

/** Fixed API hosts go through the e2e stub origin when one is set. User-given RPC URLs are fetched as is. */
function apiUrl(ctx: TestCtx, url: string): string {
  if (!ctx.apiOrigin) return url;
  const u = new URL(url);
  return `${ctx.apiOrigin}/${u.host}${u.pathname}${u.search}`;
}

async function call(ctx: TestCtx, url: string, init: RequestInit = {}): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(ctx.timeoutMs ?? TIMEOUT_MS) });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new NetError(name === "TimeoutError" || name === "AbortError");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const statusText = (s: number) => (s === 401 ? "401 unauthorized" : s === 403 ? "403 forbidden" : s === 404 ? "404 not found" : `HTTP ${s}`);

/** API keys: a network failure says nothing about the key. */
async function apiTest(fn: () => Promise<TestResult>): Promise<TestResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NetError) return untestable(e.timeout ? "Can't test: no answer within 10 s" : "Can't test: network error");
    return untestable("Can't test: unexpected answer");
  }
}

// ---------------------------------------------------------------------------------------------------------

async function anthropic(value: string, ctx: TestCtx) {
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, "https://api.anthropic.com/v1/models?limit=100"), {
      headers: { "x-api-key": value, "anthropic-version": "2023-06-01" },
    });
    if (r.status === 200) {
      const n = Array.isArray(obj(r.json).data) ? (obj(r.json).data as unknown[]).length : 0;
      return valid(`Valid: ${n} model${n === 1 ? "" : "s"} listed`);
    }
    if (r.status === 401 || r.status === 403) return invalid(`Invalid: ${statusText(r.status)}`);
    if (r.status === 429) return untestable("Can't test: rate limited, try again later");
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

async function cmc(value: string, ctx: TestCtx) {
  // /v1/key/info costs no API credits (it only counts towards the per-minute rate limit).
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, "https://pro-api.coinmarketcap.com/v1/key/info"), { headers: { "X-CMC_PRO_API_KEY": value, Accept: "application/json" } });
    if (r.status === 200) {
      const left = obj(obj(obj(obj(r.json).data).usage).current_month).credits_left;
      return valid(typeof left === "number" ? `Valid: ${left} credits left this month` : "Valid: key info returned");
    }
    if (r.status === 401 || r.status === 403) return invalid(`Invalid: ${statusText(r.status)}`);
    if (r.status === 429) return untestable("Can't test: rate limited, try again later");
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

async function etherscan(value: string, ctx: TestCtx) {
  const blockNumber = (chainId: number) =>
    call(ctx, apiUrl(ctx, `https://api.etherscan.io/v2/api?chainid=${chainId}&module=proxy&action=eth_blockNumber&apikey=${encodeURIComponent(value)}`));
  const message = (j: unknown) => String(obj(j).result ?? obj(j).message ?? "").toLowerCase();
  const isHex = (j: unknown) => typeof obj(j).result === "string" && /^0x[0-9a-f]+$/i.test(obj(j).result as string);
  return apiTest(async () => {
    const r = await blockNumber(97);
    if (r.status !== 200) return untestable(`Can't test: ${statusText(r.status)}`);
    if (isHex(r.json)) return valid("Valid: chain 97 block number returned");
    const m = message(r.json);
    if (m.includes("invalid api key") || m.includes("missing/invalid")) return invalid("Invalid: Etherscan says invalid API key");
    if (m.includes("rate limit")) return untestable("Can't test: rate limited, try again later");
    // Etherscan's free plan may not cover chain 97: check the key itself on Ethereum mainnet (also free).
    const r1 = await blockNumber(1);
    if (r1.status === 200 && isHex(r1.json)) return valid("Valid: key works; chain 97 needs a paid Etherscan plan");
    if (message(r1.json).includes("invalid api key")) return invalid("Invalid: Etherscan says invalid API key");
    return untestable("Can't test: unexpected answer from Etherscan");
  });
}

async function cloudflareToken(value: string, ctx: TestCtx) {
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, "https://api.cloudflare.com/client/v4/user/tokens/verify"), { headers: { Authorization: `Bearer ${value}` } });
    const status = obj(obj(r.json).result).status;
    if (r.status === 200 && obj(r.json).success === true) {
      return status === "active" ? valid("Valid: token active") : invalid(`Invalid: token ${typeof status === "string" ? status.replace(/[^a-z_]/gi, "") : "not active"}`);
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) return invalid(`Invalid: ${statusText(r.status === 400 ? 401 : r.status)}`);
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

async function cloudflareAccount(value: string, ctx: TestCtx) {
  const token = ctx.stored("CLOUDFLARE_API_TOKEN");
  if (!token) return untestable("Can't test: save CLOUDFLARE_API_TOKEN first");
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(value)}`), { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 200 && obj(r.json).success === true) return valid("Valid: account found with the stored token");
    if (r.status === 401) return untestable("Can't test: the stored CLOUDFLARE_API_TOKEN is not valid");
    if (r.status === 403 || r.status === 404) return invalid(`Invalid: ${statusText(r.status)} for the stored token`);
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

async function pinata(value: string, ctx: TestCtx) {
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, "https://api.pinata.cloud/data/testAuthentication"), { headers: { Authorization: `Bearer ${value}` } });
    if (r.status === 200) return valid("Valid: Pinata authentication OK");
    if (r.status === 401 || r.status === 403) return invalid(`Invalid: ${statusText(r.status)}`);
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

/** eth_chainId on a user-given RPC: here an unreachable URL does say the value is wrong. */
async function rpc(value: string, ctx: TestCtx, expect?: number): Promise<TestResult> {
  try {
    const r = await call(ctx, value, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    if (r.status >= 300 && r.status < 400) return invalid("Invalid: the RPC answered with a redirect");
    if (r.status !== 200) return invalid(`Invalid: the RPC answered ${statusText(r.status)}`);
    const hex = obj(r.json).result;
    if (typeof hex !== "string" || !/^0x[0-9a-f]+$/i.test(hex)) return invalid("Invalid: no chain id in the answer");
    const id = Number(BigInt(hex));
    if (expect !== undefined && id !== expect) return invalid(`Invalid: chainId ${id}, expected ${expect}`);
    return valid(`Valid: chainId ${id}`);
  } catch (e) {
    if (e instanceof NetError) return invalid(e.timeout ? "Invalid: no answer within 10 s" : "Invalid: the RPC could not be reached");
    return invalid("Invalid: unexpected answer");
  }
}

/** Cournot: a key has no free check (its free calls are limited), so only the format our client accepts. */
async function cournotKey(value: string) {
  return matchesFormat("cournot", value) ? valid("Valid format: a ck_live_ key (no free Cournot key check)") : invalid("Invalid: expected a ck_live_ key");
}

/** One of the two bases our client allows, and a GET of it answers (any HTTP status: it is a web front, not an API). */
async function cournotBase(value: string, ctx: TestCtx) {
  if (!matchesFormat("cournotBase", value)) return invalid("Invalid: expected https://interface.cournot.ai or https://dev-interface.cournot.ai");
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, value));
    return r.status < 500 ? valid(`Valid: answers ${statusText(r.status)}`) : untestable(`Can't test: ${statusText(r.status)}`);
  });
}

/** Living Brain (as lib/server/sponsors/livingbrain.ts calls it): x-api-key, plus x-subject-id when one is stored. */
function livingBrainHeaders(key: string, ctx: TestCtx): Record<string, string> {
  const subject = ctx.stored("LIVING_BRAIN_SUBJECT_ID");
  return { "x-api-key": key, ...(subject ? { "x-subject-id": subject } : {}) };
}

async function livingBrainKey(value: string, ctx: TestCtx) {
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, "https://api.livingbrain.com/v1/brains"), { headers: livingBrainHeaders(value, ctx) });
    if (r.status === 200) {
      const list = Array.isArray(r.json) ? r.json : obj(r.json).data;
      const n = Array.isArray(list) ? list.length : null;
      return valid(n === null ? "Valid: brains listed" : `Valid: ${n} brain${n === 1 ? "" : "s"} listed`);
    }
    if (r.status === 401 || r.status === 403) return invalid(`Invalid: ${statusText(r.status)}`);
    if (r.status === 429) return untestable("Can't test: rate limited, try again later");
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

async function livingBrainBrain(value: string, ctx: TestCtx) {
  const key = ctx.stored("LIVING_BRAIN_API_KEY");
  if (!key) return matchesFormat("token", value) ? valid("Valid format (save LIVING_BRAIN_API_KEY to check the brain exists)") : invalid("Invalid: not a brain id");
  return apiTest(async () => {
    const r = await call(ctx, apiUrl(ctx, `https://api.livingbrain.com/v1/brains/${encodeURIComponent(value)}`), { headers: livingBrainHeaders(key, ctx) });
    if (r.status === 200) return valid("Valid: brain found with the stored key");
    if (r.status === 401) return untestable("Can't test: the stored LIVING_BRAIN_API_KEY is not valid");
    if (r.status === 403 || r.status === 404) return invalid(`Invalid: ${statusText(r.status)} for the stored key`);
    return untestable(`Can't test: ${statusText(r.status)}`);
  });
}

/** WalletConnect project ids are public and have no free check: the format only. */
async function walletConnectId(value: string) {
  return matchesFormat("hex32", value) ? valid("Valid format: 32 hex characters (no free WalletConnect check)") : invalid("Invalid: expected 32 hex characters");
}

/** Tendermint /status of a Greenfield full node (free, read-only). Returns the network name, e.g. greenfield_5600-1. */
async function greenfieldNetwork(url: string, ctx: TestCtx): Promise<string | TestResult> {
  try {
    const r = await call(ctx, `${url.replace(/\/+$/, "")}/status`);
    if (r.status !== 200) return invalid(`Invalid: the RPC answered ${statusText(r.status)}`);
    const network = obj(obj(obj(r.json).result).node_info).network;
    if (typeof network !== "string" || !/^greenfield_\d+-\d+$/.test(network)) return invalid("Invalid: not a Greenfield node");
    return network;
  } catch (e) {
    if (e instanceof NetError) return invalid(e.timeout ? "Invalid: no answer within 10 s" : "Invalid: the RPC could not be reached");
    return invalid("Invalid: unexpected answer");
  }
}

async function greenfieldRpc(value: string, ctx: TestCtx) {
  const n = await greenfieldNetwork(value, ctx);
  return typeof n === "string" ? valid(`Valid: ${n}`) : n;
}

async function greenfieldChainId(value: string, ctx: TestCtx) {
  const url = ctx.stored("GREENFIELD_RPC_URL");
  if (!url) return untestable("Can't test: save GREENFIELD_RPC_URL first");
  const n = await greenfieldNetwork(url, ctx);
  if (typeof n !== "string") return untestable("Can't test: the stored GREENFIELD_RPC_URL does not answer");
  const id = n.slice("greenfield_".length).split("-")[0];
  return id === value ? valid(`Valid: matches ${n}`) : invalid(`Invalid: the RPC is chain ${id}`);
}

/** Private keys: derive the address locally, no network. Shows the address only. */
function addressOf(value: string): string | null {
  try {
    return privateKeyToAccount(value as `0x${string}`).address;
  } catch {
    return null;
  }
}

async function inspectorKey(value: string, ctx: TestCtx) {
  const address = addressOf(value);
  if (!address) return invalid("Invalid: not a valid private key");
  const expected = [ctx.stored("INSPECTOR_SIGNER_ADDRESS"), ctx.agentReportSigner].filter((a): a is string => !!a && /^0x[0-9a-fA-F]{40}$/.test(a));
  if (!expected.length) return valid(`Valid key: address ${address} (no registered signer to compare with)`);
  const match = expected.some((a) => a.toLowerCase() === address.toLowerCase());
  return match ? valid(`Valid: ${address} is the registered report signer`) : invalid(`Invalid: ${address} is not the registered report signer`);
}

async function greenfieldKey(value: string) {
  const address = addressOf(value);
  return address ? valid(`Valid key: address ${address}`) : invalid("Invalid: not a valid private key");
}

const TESTERS: Record<string, (value: string, ctx: TestCtx) => Promise<TestResult>> = {
  ANTHROPIC_API_KEY: anthropic,
  CMC_API_KEY: cmc,
  BSCSCAN_API_KEY: etherscan,
  CLOUDFLARE_API_TOKEN: cloudflareToken,
  CLOUDFLARE_ACCOUNT_ID: cloudflareAccount,
  PINATA_JWT: pinata,
  BSC_TESTNET_RPC_URL: (v, c) => rpc(v, c, 97),
  BSC_MAINNET_RPC_URL: (v, c) => rpc(v, c, 56),
  ATLAS_RPC_URL: (v, c) => rpc(v, c),
  INSPECTOR_PRIVATE_KEY: inspectorKey,
  GREENFIELD_RPC_URL: greenfieldRpc,
  GREENFIELD_CHAIN_ID: greenfieldChainId,
  GREENFIELD_PRIVATE_KEY: greenfieldKey,
  COURNOT_API_KEY: cournotKey,
  COURNOT_API_BASE: cournotBase,
  LIVING_BRAIN_API_KEY: livingBrainKey,
  LIVING_BRAIN_BRAIN_ID: livingBrainBrain,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: walletConnectId,
};

/** Names with no free, read-only check. */
const UNTESTABLE_REASON: Record<string, string> = {
  LIVING_BRAIN_SUBJECT_ID: "Can't test: any UUID works",
  ATLAS_API_KEY: "Can't test: no documented free check; it is used on the first Atlas price read",
  GREENFIELD_BUCKET: NO_FREE_TEST,
  GREENFIELD_SP_ENDPOINT: "Can't test: no free health check",
};

export const isTestable = (name: string) => name in TESTERS;

/** Runs the test of `name` on `value`; the reason is checked once more so it can never carry the value. */
export async function testSecret(name: string, value: string, ctx: TestCtx): Promise<TestResult> {
  const tester = TESTERS[name];
  if (!tester) return untestable(UNTESTABLE_REASON[name] ?? "Can't test this name");
  let r: TestResult;
  try {
    r = await tester(value, ctx);
  } catch {
    r = untestable("Can't test: unexpected error");
  }
  const reason = r.reason.slice(0, 160);
  if (value && (reason.includes(value) || (value.length > 12 && reason.includes(value.slice(-12))))) return { status: r.status, reason: r.status === "valid" ? "Valid" : r.status === "invalid" ? "Invalid" : "Can't test" };
  return { status: r.status, reason };
}
