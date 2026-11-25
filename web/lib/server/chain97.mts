/**
 * BSC testnet (chainId 97) plumbing shared by the CLI (`scripts/testnet.mts`: pnpm e2e:testnet / testnet:seed /
 * testnet:fund / testnet:status) and the server-side live demo runner (lib/server/demoTestnet). Chain 97 only:
 * every helper refuses an RPC that answers another chain id, and every transaction is signed for chain 97 (EIP-155),
 * so it cannot be replayed on BSC mainnet.
 *
 * Server and Node only. It holds key material in memory and must never be imported by a client component. It imports
 * nothing but node builtins and viem (no `@/` alias, no relative imports), so `node scripts/testnet.mts` can load it
 * directly with Node's type stripping.
 */
import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseGwei,
  toHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

export const CHAIN_ID = 97;
export const EXPLORER = "https://testnet.bscscan.com";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

// ---------------------------------------------------------------------------------------------------------
// Env files and keys
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

/** Decrypts a Web3 Secret Storage (v3) keystore, as written by `cast wallet new` / `cast wallet import`. */
export function decryptKeystore(file: string, password: string): Hex {
  const { crypto: c } = JSON.parse(readFileSync(file, "utf8"));
  const salt = Buffer.from(c.kdfparams.salt, "hex");
  let dk: Buffer;
  if (c.kdf === "scrypt") {
    const { n, r, p, dklen } = c.kdfparams;
    dk = scryptSync(password, salt, dklen, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  } else if (c.kdf === "pbkdf2") {
    dk = pbkdf2Sync(password, salt, c.kdfparams.c, c.kdfparams.dklen, "sha256");
  } else throw new Error(`unsupported keystore kdf ${c.kdf}`);
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const mac = keccak256(concat([toHex(dk.subarray(16, 32)), toHex(ciphertext)])).slice(2);
  if (mac !== String(c.mac).toLowerCase()) throw new Error("keystore password does not match (MAC check failed)");
  const d = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  return toHex(Buffer.concat([d.update(ciphertext), d.final()]));
}

/** Reads DEPLOYER_KEYSTORE, DEPLOYER_PASSWORD_FILE and DEPLOYER_ADDRESS (process.env or a parsed env file). */
export type DeployerEnv = Record<string, string | undefined>;

/** The deployer from its encrypted keystore (decrypted in memory only), cross-checked against DEPLOYER_ADDRESS. */
export function loadDeployer(env: DeployerEnv): PrivateKeyAccount {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set (repo-root .env, see docs/DEPLOY.md)`);
    return v;
  };
  const password = readFileSync(need("DEPLOYER_PASSWORD_FILE"), "utf8").replace(/\r?\n$/, "");
  const account = privateKeyToAccount(decryptKeystore(need("DEPLOYER_KEYSTORE"), password));
  if (account.address.toLowerCase() !== need("DEPLOYER_ADDRESS").toLowerCase()) {
    throw new Error("DEPLOYER_KEYSTORE does not hold DEPLOYER_ADDRESS. Refusing.");
  }
  return account;
}

/**
 * Throwaway testnet wallets, one per role, kept in a JSON file (mode 600) next to the other secrets. Created on first
 * use when `create` is set. Keys are never printed; only the file holds them.
 */
export function loadWallets<R extends string>(
  file: string,
  roles: readonly R[],
  opts: { create: boolean; note: string },
): { accounts: Record<R, PrivateKeyAccount>; created: boolean } | undefined {
  if (existsSync(file)) {
    const w = JSON.parse(readFileSync(file, "utf8")) as Record<string, { key?: Hex }>;
    const accounts = {} as Record<R, PrivateKeyAccount>;
    for (const role of roles) {
      const key = w[role]?.key;
      if (!key) throw new Error(`${path.basename(file)} has no ${role} key`);
      accounts[role] = privateKeyToAccount(key);
    }
    return { accounts, created: false };
  }
  if (!opts.create) return undefined;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const keys = Object.fromEntries(roles.map((r) => [r, generatePrivateKey()])) as Record<R, Hex>;
  const out = Object.fromEntries(roles.map((r) => [r, { address: privateKeyToAccount(keys[r]).address, key: keys[r] }]));
  writeFileSync(file, JSON.stringify({ note: opts.note, chainId: CHAIN_ID, ...out }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  const accounts = Object.fromEntries(roles.map((r) => [r, privateKeyToAccount(keys[r])])) as Record<R, PrivateKeyAccount>;
  return { accounts, created: true };
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
