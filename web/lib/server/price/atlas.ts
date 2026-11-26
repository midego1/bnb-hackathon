import { createPublicClient, formatUnits, getAddress, hexToBigInt, http, isHex, keccak256, recoverAddress, sliceHex, toHex, type Address, type Hex } from "viem";
import { ATLAS_FEED_IDS, ATLAS_OK_CONSENSUS, ATLAS_SIGNER, type AtlasStatus } from "../../atlas";
import { logSponsorCall } from "../sponsors/log";
import { atlasConfigured, readFeed, type PriceEnv } from ".";

/**
 * Atlas for the "Pay with BNB" guard, the price badge and the settlement's price proof (server-side only):
 *   - push: the BNB/USD feed (AggregatorV3, 18 decimals), refused when older than 2x its heartbeat;
 *   - pull: POST api.atlasoracle.io/report/v1/price/latest (X-API-KEY, never in the browser), signed report for
 *     BNB/USD (633) + USDT/USD (649) with a consensus per feed, verified here against Atlas's official signer.
 * Both are cached 30 s.
 */

export interface AtlasEnv extends PriceEnv {
  ATLAS_API_KEY?: string;
  /** BNB/USD push feed heartbeat in seconds (default 60, Atlas's BSC BNB/USD heartbeat); answers older than 2x are refused. */
  ATLAS_HEARTBEAT_SECONDS?: string;
}

const PULL_URL = "https://api.atlasoracle.io/report/v1/price/latest";
const TTL_MS = 30_000;
/** secp256k1 n/2: Atlas's consumer contract refuses high-s signatures (EIP-2), so this does too. */
const MAX_LOW_S = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

type FetchLike = typeof fetch;
export type AtlasConsensus = { feedId: number; consensusScore: number; consensusStatus: string };
/** The Pull API's `data` (fields we use). */
export type AtlasPullReport = { payload: Hex; signature: Hex; consensusScores: AtlasConsensus[] };

/** The signed report attached to a settlement: what was signed, by whom, and the prices in it. */
export interface AtlasPriceProof {
  source: "atlas-pull";
  /** keccak256 of the signed bytes ([packages][count]): the digest Atlas signed. */
  hash: Hex;
  signer: Address;
  payload: Hex;
  signature: Hex;
  prices: { feedId: number; price: string; timestamp: number }[];
}

export async function fetchAtlasReport(env: AtlasEnv, fetchImpl: FetchLike = fetch): Promise<AtlasPullReport> {
  const started = Date.now();
  const endpoint = "POST /report/v1/price/latest";
  let status: number | null = null;
  try {
    const res = await fetchImpl(PULL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": env.ATLAS_API_KEY! },
      body: JSON.stringify({ feedIds: [ATLAS_FEED_IDS.BNB_USD, ATLAS_FEED_IDS.USDT_USD], signed: true }),
      signal: AbortSignal.timeout(8_000),
    });
    status = res.status;
    if (!res.ok) throw new Error(`Atlas Pull API ${res.status}`);
    const data = ((await res.json()) as { data?: Partial<AtlasPullReport> }).data;
    if (!data || !isHex(data.payload) || !isHex(data.signature) || !Array.isArray(data.consensusScores)) throw new Error("Atlas Pull API: unexpected response");
    await logSponsorCall({ sponsor: "atlas", endpoint, at: new Date(started).toISOString(), status, ok: true, ms: Date.now() - started, note: "feeds 633,649 signed" });
    return data as AtlasPullReport;
  } catch (err) {
    await logSponsorCall({ sponsor: "atlas", endpoint, at: new Date(started).toISOString(), status, ok: false, ms: Date.now() - started, note: (err as Error).message.slice(0, 160) });
    throw err;
  }
}

/**
 * Checks a Pull API report the way Atlas's consumer contract does (PullOracleSignature): keccak256 over
 * [packages (20 B each: 4 B feed id, 10 B price with 18 decimals, 6 B timestamp)][1 B count], no EIP-191 prefix,
 * low-s, recovered signer == `signer`. Throws when it does not verify.
 */
export async function verifyAtlasReport(r: Pick<AtlasPullReport, "payload" | "signature">, signer: Address = ATLAS_SIGNER): Promise<AtlasPriceProof> {
  const len = (r.payload.length - 2) / 2;
  // The payload may or may not carry the trailing count byte: the signed bytes always do.
  const count = Math.floor(len / 20);
  const signed: Hex = len % 20 === 0 && count > 0 ? `${r.payload}${toHex(count, { size: 1 }).slice(2)}` : r.payload;
  if (count === 0 || count > 255 || (len % 20 === 1 && hexToBigInt(sliceHex(r.payload, len - 1)) !== BigInt(count)) || len % 20 > 1) {
    throw new Error("Atlas report: malformed payload");
  }
  if (r.signature.length !== 132 || hexToBigInt(sliceHex(r.signature, 32, 64)) > MAX_LOW_S) throw new Error("Atlas report: malformed signature");
  const hash = keccak256(signed);
  const recovered = await recoverAddress({ hash, signature: r.signature });
  if (recovered !== getAddress(signer)) throw new Error(`Atlas report: signed by ${recovered}, not the official Atlas signer`);
  const prices = Array.from({ length: count }, (_, i) => ({
    feedId: Number(hexToBigInt(sliceHex(signed, i * 20, i * 20 + 4))),
    price: formatUnits(hexToBigInt(sliceHex(signed, i * 20 + 4, i * 20 + 14)), 18),
    timestamp: Number(hexToBigInt(sliceHex(signed, i * 20 + 14, i * 20 + 20))),
  }));
  return { source: "atlas-pull", hash, signer: recovered, payload: r.payload, signature: r.signature, prices };
}

export interface AtlasDeps {
  fetch?: FetchLike;
  now?: () => number;
  /** Override of the official signer (tests: the fixture is signed by a test key). */
  signer?: Address;
  /** Override of the push-feed reader (tests). */
  readBnbUsd?: (env: AtlasEnv, maxAgeSec: number) => Promise<{ answer: bigint; decimals: number; updatedAt: number }>;
}

const readBnbUsd = (env: AtlasEnv, maxAgeSec: number) =>
  readFeed(createPublicClient({ transport: http(env.ATLAS_RPC_URL, { timeout: 8_000 }) }), env.ATLAS_FEED_BNB_USD!, maxAgeSec);

/** Push feed + Pull API, uncached: the guard verdict for a swap, and the verified signed report (or null). */
export async function loadAtlas(env: AtlasEnv, deps: AtlasDeps = {}): Promise<{ status: AtlasStatus; proof: AtlasPriceProof | null }> {
  const now = deps.now?.() ?? Date.now();
  const heartbeat = Number(env.ATLAS_HEARTBEAT_SECONDS);
  const maxAgeSec = 2 * (Number.isFinite(heartbeat) && heartbeat > 0 ? heartbeat : 60);
  const base = { ok: false, maxAgeSec, fetchedAt: new Date(now).toISOString() };
  const [push, pull] = await Promise.allSettled([
    atlasConfigured(env) ? (deps.readBnbUsd ?? readBnbUsd)(env, maxAgeSec) : Promise.reject(new Error("Atlas feeds are not configured")),
    env.ATLAS_API_KEY ? fetchAtlasReport(env, deps.fetch).then(async (r) => ({ r, proof: await verifyAtlasReport(r, deps.signer) })) : Promise.reject(new Error("Atlas Pull API key is not set")),
  ]);
  const proof = pull.status === "fulfilled" ? pull.value.proof : null;
  if (push.status === "rejected") return { status: { ...base, reason: (push.reason as Error).message }, proof };
  const { answer, decimals, updatedAt } = push.value;
  const e18 = answer * BigInt(10) ** BigInt(18 - decimals);
  const feed = { ...base, bnbUsdE18: e18.toString(), bnbUsd: Number(formatUnits(e18, 18)), updatedAt: new Date(updatedAt * 1000).toISOString() };
  if (pull.status === "rejected") return { status: { ...feed, reason: `consensus unknown: ${(pull.reason as Error).message}` }, proof };
  const c = pull.value.r.consensusScores.find((s) => Number(s.feedId) === ATLAS_FEED_IDS.BNB_USD);
  const consensus = c && { score: Number(c.consensusScore), status: String(c.consensusStatus) };
  if (!consensus || !ATLAS_OK_CONSENSUS.includes(consensus.status)) {
    return { status: { ...feed, ...(consensus ? { consensus } : {}), reason: `Atlas consensus is ${consensus?.status ?? "missing"}` }, proof };
  }
  return { status: { ...feed, ok: true, consensus }, proof };
}

// shortcut: per-process (per-isolate on Workers) cache of settled results (a Worker request must not await another
// request's promise), no in-flight de-duplication; move to the shared Durable Object like PriceService if the Pull API
// quota gets tight.
let cache: { at: number; value: Awaited<ReturnType<typeof loadAtlas>> } | null = null;

/** loadAtlas, cached 30 s. */
export async function getAtlas(env: AtlasEnv = process.env as AtlasEnv) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await loadAtlas(env);
  cache = { at: Date.now(), value };
  return value;
}
