/**
 * BSC testnet (chainId 97) plumbing shared by the CLI (`scripts/testnet.mts`: pnpm e2e:testnet / testnet:seed /
 * testnet:fund / testnet:status) and the server-side live demo runner (lib/server/demoTestnet). Chain 97 only:
 * every helper refuses an RPC that answers another chain id, and every transaction is signed for chain 97 (EIP-155),
 * so it cannot be replayed on BSC mainnet.
 *
 * Server only, and runtime-neutral: viem and nothing else (no node:fs), so it also runs on Cloudflare Workers. Reading
 * keys from disk lives in chain97-keys.mts (Node only). No `@/` alias and no relative imports, so
 * `node scripts/testnet.mts` can load it directly with Node's type stripping.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseGwei,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

export const CHAIN_ID = 97;
export const EXPLORER = "https://testnet.bscscan.com";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

// ---------------------------------------------------------------------------------------------------------
// Env files
// ---------------------------------------------------------------------------------------------------------

/** KEY=value lines of a dotenv file (quotes stripped, `export` allowed, comments and blanks skipped). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (v) out[m[1]] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Clients and sending (explicit legacy gas price, local nonces)
// ---------------------------------------------------------------------------------------------------------

/** Explicit legacy gas price in gwei (BSC has no base fee). Default 1, refused outside 0.1-10. */
export function gasPriceFrom(gwei: string | undefined): bigint {
  const price = parseGwei(gwei || "1");
  if (price < parseGwei("0.1") || price > parseGwei("10")) throw new Error("TESTNET_GAS_PRICE_GWEI must be 0.1-10");
  return price;
}

export type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

export type Chain97 = ReturnType<typeof createChain97>;

/**
 * Public client plus a sender for chain 97. `send` simulates first (a revert is caught for free instead of burning
 * gas), estimates gas, refuses anything over `maxGas`, then signs a legacy tx at the explicit gas price.
 */
export function createChain97(opts: { rpc: string; gasPrice: bigint; receiptTimeoutMs?: number }) {
  const chain = { ...bscTestnet, rpcUrls: { default: { http: [opts.rpc] } } };
  const transport = http(opts.rpc, { retryCount: 5, retryDelay: 750, timeout: 30_000 });
  const pub = createPublicClient({ chain, transport, pollingInterval: 1_500 }) as PublicClient;
  const nonces = new Map<string, number>();
  const receiptTimeoutMs = opts.receiptTimeoutMs ?? 180_000;

  async function assertChain97() {
    const id = await pub.getChainId();
    if (id !== CHAIN_ID) throw new Error(`The RPC answers chainId ${id}, expected ${CHAIN_ID}. Refusing.`);
  }

  /** The next nonce: the higher of the local count and the node's pending count (survives lag and drift). */
  async function nextNonce(a: Address): Promise<number> {
    const key = a.toLowerCase();
    const remote = await pub.getTransactionCount({ address: a, blockTag: "pending" });
    const n = Math.max(remote, nonces.get(key) ?? 0);
    nonces.set(key, n + 1);
    return n;
  }
  const forgetNonce = (a: Address) => nonces.delete(a.toLowerCase());

  async function broadcast(who: PrivateKeyAccount, tx: Record<string, unknown>): Promise<Hash> {
    const wallet = createWalletClient({ chain, transport, account: who });
    try {
      return await wallet.sendTransaction({ ...tx, type: "legacy", gasPrice: opts.gasPrice, nonce: await nextNonce(who.address) } as never);
    } catch (e) {
      forgetNonce(who.address); // a tx that never left must not leave a gap in the local nonce count
      throw e;
    }
  }

  /** Simulates and estimates a contract call (eth_call + eth_estimateGas, both free). */
  async function prepare(who: PrivateKeyAccount, call: Call) {
    await pub.simulateContract({ account: who, ...call, args: call.args ?? [] } as never);
    const estimate = await pub.estimateContractGas({ account: who, ...call, args: call.args ?? [] } as never);
    return { gas: (estimate * 6n) / 5n + 5_000n };
  }

  async function sendCall(who: PrivateKeyAccount, call: Call, limits: { maxGas?: bigint } = {}): Promise<{ hash: Hash; gas: bigint }> {
    const { gas } = await prepare(who, call);
    if (limits.maxGas !== undefined && gas > limits.maxGas) {
      throw new GasCapError(`${call.functionName} needs about ${gas} gas, over the ${limits.maxGas} gas left for this run`);
    }
    const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] } as never);
    return { hash: await broadcast(who, { to: call.address, data, gas }), gas };
  }

  async function sendValue(who: PrivateKeyAccount, to: Address, value: bigint): Promise<Hash> {
    return broadcast(who, { to, value, gas: 21_000n });
  }

  async function wait(hash: Hash, timeoutMs = receiptTimeoutMs): Promise<TransactionReceipt> {
    try {
      return await pub.waitForTransactionReceipt({ hash, timeout: timeoutMs, retryCount: 20 });
    } catch (e) {
      if (e instanceof Error && /timed out|timeout/i.test(e.name + e.message)) throw new TxStalledError(hash, timeoutMs);
      throw e;
    }
  }

  return { chain, transport, pub, gasPrice: opts.gasPrice, assertChain97, nextNonce, forgetNonce, prepare, sendCall, sendValue, wait };
}

export class GasCapError extends Error {
  name = "GasCapError";
}

// No TS parameter properties here: Node's type stripping (scripts/testnet.mts) does not support them.
export class TxStalledError extends Error {
  name = "TxStalledError";
  readonly hash: Hash;
  readonly timeoutMs: number;
  constructor(hash: Hash, timeoutMs: number) {
    super(`transaction ${hash} was not mined within ${Math.round(timeoutMs / 1000)} s (${txUrl(hash)})`);
    this.hash = hash;
    this.timeoutMs = timeoutMs;
  }
}
