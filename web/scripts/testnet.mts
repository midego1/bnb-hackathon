/**
 * KeyEscrow on the LIVE BSC testnet (chainId 97). Never any other chain: the RPC must answer 97 and every
 * transaction is signed for chain 97 (EIP-155), so it cannot be replayed on BSC mainnet.
 *
 *   pnpm e2e:testnet                 happy + dispute paths against contracts/deployments/97.json, with throwaway
 *                                    landlord/tenant wallets funded by the deployer; writes a tx report
 *   pnpm testnet:seed                leaves a few open leases (offer, active, disputed) between the test wallets
 *                                    so the testnet web app has something to show
 *   pnpm testnet:fund <address>      sends 0.01 tBNB + 10,000 mUSDT from the deployer to <address>
 *   pnpm testnet:status              balances of the deployer and the test wallets (sends nothing)
 *
 * The landlord-response and arbiter timeouts need 7 / 14 days of real time, so they are not run here; they are
 * covered against anvil by `pnpm e2e:chain` (time travel).
 *
 * Env, from the repo-root .env (a git worktree falls back to the main checkout's .env); the shell wins:
 *   BSC_TESTNET_RPC_URL                     required, must answer chainId 97
 *   DEPLOYER_KEYSTORE, DEPLOYER_PASSWORD_FILE   the deployer's encrypted keystore (decrypted in memory only)
 *   DEPLOYER_ADDRESS                        cross-checked against the decrypted key
 *   TESTNET_GAS_PRICE_GWEI                  optional, default 1 (explicit legacy gas price; BSC has no base fee)
 *   KEYESCROW_SECRETS_DIR                   optional, default <main checkout>/.orca/secrets (test wallet keys)
 *   KEYESCROW_REPORT                        optional, default <main checkout>/.orca/reports/testnet-<e2e|seed>.md
 * Keys are never printed or logged. The test wallet keys live in <secrets>/testnet-e2e-wallets.json (mode 600).
 */
import { spawnSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  concat,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEther,
  parseEventLogs,
  parseGwei,
  parseUnits,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

// ---------------------------------------------------------------------------------------------------------
// Paths and environment
// ---------------------------------------------------------------------------------------------------------

const CHAIN_ID = 97;
const EXPLORER = "https://testnet.bscscan.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACTS = path.join(ROOT, "contracts");

/** The main checkout (differs from ROOT inside a git worktree), where the gitignored .env and .orca/ live. */
function mainCheckout(): string {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? path.dirname(r.stdout.trim()) : ROOT;
}
const MAIN = mainCheckout();

function loadDotenv() {
  const file = process.env.KEYESCROW_ENV_FILE ?? [path.join(ROOT, ".env"), path.join(MAIN, ".env")].find(existsSync);
  if (!file || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (!process.env[m[1]] && v) process.env[m[1]] = v;
  }
}
loadDotenv();

const SECRETS_DIR = process.env.KEYESCROW_SECRETS_DIR ?? path.join(MAIN, ".orca/secrets");
const WALLETS_FILE = path.join(SECRETS_DIR, "testnet-e2e-wallets.json");
const reportFile = (which: string) => process.env.KEYESCROW_REPORT ?? path.join(MAIN, `.orca/reports/testnet-${which}.md`);

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (repo-root .env, see docs/DEPLOY.md)`);
  return v;
}

// ---------------------------------------------------------------------------------------------------------
// Chain clients (chain 97 only)
// ---------------------------------------------------------------------------------------------------------

const RPC = need("BSC_TESTNET_RPC_URL");
const chain = { ...bscTestnet, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { retryCount: 5, retryDelay: 750, timeout: 30_000 });
const pub = createPublicClient({ chain, transport, pollingInterval: 1_500 });
const GAS_PRICE = parseGwei(process.env.TESTNET_GAS_PRICE_GWEI ?? "1");
if (GAS_PRICE < parseGwei("0.1") || GAS_PRICE > parseGwei("10")) throw new Error("TESTNET_GAS_PRICE_GWEI must be 0.1-10");

async function assertChain97() {
  const id = await pub.getChainId();
  if (id !== CHAIN_ID) throw new Error(`BSC_TESTNET_RPC_URL answers chainId ${id}, expected ${CHAIN_ID}. Refusing.`);
}

const deployment = JSON.parse(readFileSync(path.join(CONTRACTS, "deployments", `${CHAIN_ID}.json`), "utf8")) as {
  chainId: number;
  token: Address;
  escrowFactory: Address;
  feeRecipient: Address;
  defaultArbiter: Address;
  feeBps: number;
};
if (deployment.chainId !== CHAIN_ID) throw new Error("contracts/deployments/97.json is not a chain 97 deployment");

function artifactAbi(name: string): Abi {
  const file = path.join(CONTRACTS, "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(file)) throw new Error(`missing ${file}: run \`cd contracts && forge build\` first`);
  return JSON.parse(readFileSync(file, "utf8")).abi as Abi;
}
const tokenAbi = artifactAbi("MockUSDT");
const factoryAbi = artifactAbi("EscrowFactory");
const escrowAbi = artifactAbi("RentalEscrow");

// ---------------------------------------------------------------------------------------------------------
// Keys: deployer keystore (in memory) and the throwaway test wallets
// ---------------------------------------------------------------------------------------------------------

/** Decrypts a Web3 Secret Storage (v3) keystore, as written by `cast wallet new` / `cast wallet import`. */
function decryptKeystore(file: string, password: string): Hex {
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

function loadDeployer(): PrivateKeyAccount {
  const password = readFileSync(need("DEPLOYER_PASSWORD_FILE"), "utf8").replace(/\r?\n$/, "");
  const account = privateKeyToAccount(decryptKeystore(need("DEPLOYER_KEYSTORE"), password));
  if (account.address.toLowerCase() !== need("DEPLOYER_ADDRESS").toLowerCase()) {
    throw new Error("DEPLOYER_KEYSTORE does not hold DEPLOYER_ADDRESS. Refusing.");
  }
  return account;
}

type Wallets = { landlord: PrivateKeyAccount; tenant: PrivateKeyAccount; created: boolean };

/** Loads the throwaway landlord/tenant keys, creating them on first use (file mode 600, never printed). */
function loadTestWallets(create: boolean): Wallets | undefined {
  if (existsSync(WALLETS_FILE)) {
    const w = JSON.parse(readFileSync(WALLETS_FILE, "utf8")) as Record<"landlord" | "tenant", { key: Hex }>;
    return { landlord: privateKeyToAccount(w.landlord.key), tenant: privateKeyToAccount(w.tenant.key), created: false };
  }
  if (!create) return undefined;
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  const keys = { landlord: generatePrivateKey(), tenant: generatePrivateKey() };
  const out = Object.fromEntries(
    Object.entries(keys).map(([role, key]) => [role, { address: privateKeyToAccount(key).address, key }]),
  );
  const note = "KeyEscrow BSC testnet (97) throwaway test wallets. Testnet only. Never fund on mainnet. Never commit.";
  writeFileSync(WALLETS_FILE, JSON.stringify({ note, chainId: CHAIN_ID, ...out }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(WALLETS_FILE, 0o600);
  return { landlord: privateKeyToAccount(keys.landlord), tenant: privateKeyToAccount(keys.tenant), created: true };
}

// ---------------------------------------------------------------------------------------------------------
// Sending, with an explicit gas price, local nonces and a ledger of every transaction
// ---------------------------------------------------------------------------------------------------------

type Entry = { section: string; step: string; from: string; hash: Hash; gasUsed: bigint; cost: bigint; ok: boolean };
const ledger: Entry[] = [];
const names = new Map<string, string>();
const label = (a: Address) => names.get(a.toLowerCase()) ?? a;
let section = "";
/** Block of the latest receipt: reads are pinned to it so a lagging RPC backend cannot serve stale state. */
let lastBlock = 0n;
const nonces = new Map<string, number>();

async function nextNonce(a: Address): Promise<number> {
  const key = a.toLowerCase();
  if (!nonces.has(key)) nonces.set(key, await pub.getTransactionCount({ address: a, blockTag: "pending" }));
  const n = nonces.get(key)!;
  nonces.set(key, n + 1);
  return n;
}

async function finish(step: string, who: PrivateKeyAccount, hash: Hash): Promise<TransactionReceipt> {
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000, retryCount: 20 });
  lastBlock = r.blockNumber > lastBlock ? r.blockNumber : lastBlock;
  const cost = r.gasUsed * r.effectiveGasPrice;
  ledger.push({ section, step, from: label(who.address), hash, gasUsed: r.gasUsed, cost, ok: r.status === "success" });
  console.log(`    ${r.status === "success" ? "ok " : "REV"} ${step.padEnd(34)} ${String(r.gasUsed).padStart(7)} gas  ${EXPLORER}/tx/${hash}`);
  if (r.status !== "success") throw new Error(`${step} reverted (${EXPLORER}/tx/${hash})`);
  return r;
}

async function send(step: string, who: PrivateKeyAccount, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
  // Simulate first: a revert is caught for free instead of burning gas on-chain.
  const { request } = await pub.simulateContract({ account: who, address, abi, functionName, args });
  const wallet = createWalletClient({ chain, transport, account: who });
  const hash = await wallet.writeContract({
    ...request,
    type: "legacy",
    gasPrice: GAS_PRICE,
    nonce: await nextNonce(who.address),
  } as never);
  return finish(step, who, hash);
}

async function sendValue(step: string, who: PrivateKeyAccount, to: Address, value: bigint) {
  const wallet = createWalletClient({ chain, transport, account: who });
  const hash = await wallet.sendTransaction({
    to,
    value,
    type: "legacy",
    gasPrice: GAS_PRICE,
    gas: 21_000n,
    nonce: await nextNonce(who.address),
  });
  return finish(step, who, hash);
}

/** eth_call only (free): the call must revert with `error`. */
async function simulateReverts(error: string, who: Address, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
  try {
    await pub.simulateContract({ account: who, address, abi, functionName, args });
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    eq(name, error, `${functionName} by ${label(who)} reverts`);
    return;
  }
  throw new Error(`assertion failed: ${functionName} by ${label(who)} should revert with ${error}`);
}

/** Reads at the block of the latest receipt, retrying while the RPC backend catches up. */
async function read<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return (await pub.readContract({ address, abi, functionName, args, ...(lastBlock ? { blockNumber: lastBlock } : {}) })) as T;
    } catch (e) {
      if (i >= 10) throw e;
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------------------

const USDT = (v: string) => parseUnits(v, 6);
const fmt = (v: bigint) => `${formatUnits(v, 6)} mUSDT`;
let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string) {
  const show = (v: T) => (typeof v === "bigint" ? `${v} (${fmt(v)})` : String(v));
  const same = typeof actual === "string" && typeof expected === "string" ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  assert(same, `${msg}: expected ${show(expected)}, got ${show(actual)}`);
}

const Status = { Created: 0, Active: 1, MoveOut: 2, Disputed: 3, Settled: 4, Cancelled: 5 } as const;
const EvidenceKind = { CheckIn: 0, CheckOut: 1, Other: 2 } as const;

// Small test lease: 100 mUSDT/month, 200 mUSDT deposit. Fee = 10% of ONE month, once per lease.
const RENT = USDT("100");
const DEPOSIT = USDT("200");

type Roles = { landlord: PrivateKeyAccount; tenant: PrivateKeyAccount; desk: PrivateKeyAccount; treasury: Address; feeBps: bigint };
const tokenBalance = (who: Address) => read<bigint>(deployment.token, tokenAbi, "balanceOf", [who]);
async function balances(r: Roles, escrow: Address) {
  return {
    landlord: await tokenBalance(r.landlord.address),
    tenant: await tokenBalance(r.tenant.address),
    treasury: await tokenBalance(r.treasury),
    escrow: await tokenBalance(escrow),
  };
}
type Balances = Awaited<ReturnType<typeof balances>>;
function expectDeltas(before: Balances, after: Balances, d: Partial<Balances>, what: string) {
  let sum = 0n;
  for (const k of ["landlord", "tenant", "treasury", "escrow"] as const) {
    eq(after[k] - before[k], d[k] ?? 0n, `${what}: ${k} balance change`);
    sum += after[k] - before[k];
  }
  eq(sum, 0n, `${what}: token totals are conserved`);
}
const status = async (escrow: Address) => Number(await read<number>(escrow, escrowAbi, "status"));

async function createLease(r: Roles, step: string, opts: { arbiterWindow?: number } = {}): Promise<Address> {
  const receipt = await send(step, r.landlord, deployment.escrowFactory, factoryAbi, "createLease", [
    {
      tenant: r.tenant.address,
      arbiter: zeroAddress, // KeyEscrow dispute desk
      rentAmount: RENT,
      depositAmount: DEPOSIT,
      termMonths: 12,
      responseWindow: 0,
      arbiterWindow: opts.arbiterWindow ?? 0,
      leaseHash: keccak256(toHex(`testnet e2e lease ${Date.now()}`)),
    },
  ]);
  const [ev] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "LeaseCreated" });
  const escrow = getAddress((ev as unknown as { args: { escrow: Address } }).args.escrow);
  names.set(escrow.toLowerCase(), "escrow");
  const t = await read<Record<string, unknown>>(escrow, escrowAbi, "terms");
  eq(t.arbiter as string, r.desk.address, "lease arbiter = KeyEscrow dispute desk");
  eq(t.feeRecipient as string, r.treasury, "lease fee recipient = treasury");
  eq(BigInt(t.feeBps as number), r.feeBps, "lease fee bps");
  eq(await status(escrow), Status.Created, "status after create");
  return escrow;
}

async function fund(r: Roles, escrow: Address, extraMonths = 0) {
  await send("tenant approve", r.tenant, deployment.token, tokenAbi, "approve", [escrow, DEPOSIT + RENT * BigInt(1 + extraMonths)]);
  await send("tenant fund (deposit + month 1)", r.tenant, escrow, escrowAbi, "fund");
  if (extraMonths) await send(`tenant payRent(${extraMonths}) prepay`, r.tenant, escrow, escrowAbi, "payRent", [extraMonths]);
  eq(await status(escrow), Status.Active, "status after funding");
  eq(await tokenBalance(escrow), DEPOSIT + RENT * BigInt(1 + extraMonths), "escrow holds deposit + funded rent");
}

// ---------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------

const leasesUsed: { path: string; escrow: Address }[] = [];

async function happyPath(r: Roles) {
  const fee = (RENT * r.feeBps) / 10_000n;
  const escrow = await createLease(r, "landlord createLease");
  leasesUsed.push({ path: "happy", escrow });
  await fund(r, escrow, 1); // month 1 + prepaid month 2

  let before = await balances(r, escrow);
  await send("landlord releaseRent (month 1)", r.landlord, escrow, escrowAbi, "releaseRent");
  expectDeltas(before, await balances(r, escrow), { landlord: RENT - fee, treasury: fee, escrow: -RENT }, "rent release");
  // Month 2 is prepaid but not due for 30 days: nothing more for the landlord yet.
  await simulateReverts("NothingToRelease", r.landlord.address, escrow, escrowAbi, "releaseRent");

  const claim = USDT("30");
  await send("tenant addEvidence (check-out)", r.tenant, escrow, escrowAbi, "addEvidence", [EvidenceKind.CheckOut, keccak256(toHex("checkout-manifest"))]);
  await send("tenant propose (30 mUSDT cleaning)", r.tenant, escrow, escrowAbi, "propose", [DEPOSIT - claim, keccak256(toHex("ai-report"))]);
  eq(await status(escrow), Status.MoveOut, "status after proposal");
  await simulateReverts("ProposerCannotAccept", r.tenant.address, escrow, escrowAbi, "accept", [1]);

  before = await balances(r, escrow);
  await send("landlord accept -> settled", r.landlord, escrow, escrowAbi, "accept", [1]);
  // The prepaid, not-yet-due month 2 goes back to the tenant with the agreed refund.
  expectDeltas(before, await balances(r, escrow), { landlord: claim, tenant: DEPOSIT - claim + RENT, escrow: -(DEPOSIT + RENT) }, "settlement");
  eq(await status(escrow), Status.Settled, "status after accept");
  eq(await tokenBalance(escrow), 0n, "escrow empty after settlement");
  return `landlord +${fmt(RENT - fee + claim)} (month 1 - ${fmt(fee)} fee + ${fmt(claim)} claim), treasury +${fmt(fee)}, tenant back ${fmt(DEPOSIT - claim + RENT)} (refund + prepaid month)`;
}

async function disputePath(r: Roles) {
  const fee = (RENT * r.feeBps) / 10_000n;
  const escrow = await createLease(r, "landlord createLease");
  leasesUsed.push({ path: "dispute", escrow });
  await fund(r, escrow);
  let before = await balances(r, escrow);
  await send("landlord releaseRent (month 1)", r.landlord, escrow, escrowAbi, "releaseRent");
  expectDeltas(before, await balances(r, escrow), { landlord: RENT - fee, treasury: fee, escrow: -RENT }, "rent release");

  await send("landlord propose (claims full deposit)", r.landlord, escrow, escrowAbi, "propose", [0n, keccak256(toHex("landlord claims all"))]);
  await send("tenant dispute", r.tenant, escrow, escrowAbi, "dispute");
  eq(await status(escrow), Status.Disputed, "status after dispute");
  await simulateReverts("Unauthorized", r.landlord.address, escrow, escrowAbi, "resolve", [DEPOSIT, keccak256(toHex("x"))]);

  const award = USDT("50");
  before = await balances(r, escrow);
  await send("dispute desk resolve (50 to landlord)", r.desk, escrow, escrowAbi, "resolve", [DEPOSIT - award, keccak256(toHex("ruling"))]);
  expectDeltas(before, await balances(r, escrow), { landlord: award, tenant: DEPOSIT - award, escrow: -DEPOSIT }, "arbiter ruling");
  eq(await status(escrow), Status.Settled, "status after ruling");
  eq(await tokenBalance(escrow), 0n, "escrow empty after ruling");
  return `dispute desk awarded landlord ${fmt(award)}, tenant ${fmt(DEPOSIT - award)}; treasury +${fmt(fee)} on the rent release`;
}

/** Open leases for the web app: an unfunded offer, an active lease and a disputed one (60-day arbiter window). */
async function seed(r: Roles) {
  const offer = await createLease(r, "seed: landlord createLease (offer)");
  const active = await createLease(r, "seed: landlord createLease (active)");
  await fund(r, active);
  await send("seed: landlord releaseRent", r.landlord, active, escrowAbi, "releaseRent");
  const disputed = await createLease(r, "seed: landlord createLease (dispute)", { arbiterWindow: 60 * 86_400 });
  await fund(r, disputed);
  await send("seed: landlord propose (claims 80)", r.landlord, disputed, escrowAbi, "propose", [DEPOSIT - USDT("80"), keccak256(toHex("seed claim"))]);
  await send("seed: tenant dispute", r.tenant, disputed, escrowAbi, "dispute");
  for (const [p, escrow] of [["seed offer (Created)", offer], ["seed active (Active)", active], ["seed disputed (Disputed)", disputed]] as const) {
    leasesUsed.push({ path: p, escrow });
  }
  return `offer ${offer}, active ${active}, disputed ${disputed}`;
}

// ---------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------

/** What each test wallet should hold before a run. Measured: a full e2e run uses ~0.0015 tBNB per wallet at 1 gwei. */
const GAS_FLOAT = parseEther("0.004");
const TOKEN_FLOAT = USDT("2000");

async function setup() {
  await assertChain97();
  const deployer = loadDeployer();
  const w = loadTestWallets(true)!;
  names.set(deployer.address.toLowerCase(), "deployer/desk");
  names.set(w.landlord.address.toLowerCase(), "landlord");
  names.set(w.tenant.address.toLowerCase(), "tenant");

  const onchain = {
    token: await read<Address>(deployment.escrowFactory, factoryAbi, "token"),
    desk: await read<Address>(deployment.escrowFactory, factoryAbi, "defaultArbiter"),
    treasury: await read<Address>(deployment.escrowFactory, factoryAbi, "feeRecipient"),
    feeBps: BigInt(await read<number>(deployment.escrowFactory, factoryAbi, "feeBps")),
  };
  eq(onchain.token, deployment.token, "factory.token() = deployments/97.json token");
  eq(onchain.desk, deployment.defaultArbiter, "factory.defaultArbiter() = deployments/97.json");
  eq(onchain.treasury, deployment.feeRecipient, "factory.feeRecipient() = deployments/97.json");
  // The dispute desk must be a wallet this script can sign for; on testnet that is the deployer.
  eq(onchain.desk, deployer.address, "dispute desk is the deployer wallet");
  names.set(onchain.treasury.toLowerCase(), onchain.treasury.toLowerCase() === deployer.address.toLowerCase() ? "deployer/desk" : "treasury");

  const roles: Roles = { landlord: w.landlord, tenant: w.tenant, desk: deployer, treasury: getAddress(onchain.treasury), feeBps: onchain.feeBps };
  return { deployer, roles, created: w.created };
}

async function topUp(deployer: PrivateKeyAccount, r: Roles) {
  section = "setup";
  for (const who of [r.landlord, r.tenant]) {
    const bal = await pub.getBalance({ address: who.address });
    if (bal < GAS_FLOAT / 2n) await sendValue(`deployer -> ${label(who.address)} ${formatEther(GAS_FLOAT - bal)} tBNB`, deployer, who.address, GAS_FLOAT - bal);
  }
  const tb = await tokenBalance(r.tenant.address);
  if (tb < TOKEN_FLOAT / 2n) await send(`tenant faucet ${fmt(TOKEN_FLOAT - tb)}`, r.tenant, deployment.token, tokenAbi, "faucet", [r.tenant.address, TOKEN_FLOAT - tb]);
}

async function bnbBalances(addrs: Address[]) {
  return Promise.all(addrs.map((a) => pub.getBalance({ address: a, ...(lastBlock ? { blockNumber: lastBlock } : {}) })));
}

async function cmdRun(which: "e2e" | "seed") {
  const { deployer, roles, created } = await setup();
  const addrs = [deployer.address, roles.landlord.address, roles.tenant.address];
  console.log(`BSC testnet (97) via ${new URL(RPC).host}, gas price ${formatUnits(GAS_PRICE, 9)} gwei`);
  console.log(`  factory ${deployment.escrowFactory}  token ${deployment.token}`);
  console.log(`  deployer/desk/treasury ${deployer.address}  landlord ${roles.landlord.address}  tenant ${roles.tenant.address}${created ? " (new)" : ""}`);
  const startBnb = await bnbBalances(addrs);

  await topUp(deployer, roles);
  const paths: [string, (r: Roles) => Promise<string>][] = which === "e2e" ? [["happy", happyPath], ["dispute", disputePath]] : [["seed", seed]];
  const results: { name: string; ok: boolean; detail: string }[] = [];
  for (const [name, fn] of paths) {
    section = name;
    console.log(`  ${name}:`);
    try {
      results.push({ name, ok: true, detail: await fn(roles) });
      console.log(`  PASS  ${name.padEnd(8)} ${results.at(-1)!.detail}`);
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      console.log(`  FAIL  ${name.padEnd(8)} ${results.at(-1)!.detail}`);
    }
  }
  const endBnb = await bnbBalances(addrs);
  const failed = results.filter((x) => !x.ok);
  const gasCost = ledger.reduce((s, e) => s + e.cost, 0n);
  const gasUsed = ledger.reduce((s, e) => s + e.gasUsed, 0n);
  console.log(`\n${results.length - failed.length}/${results.length} paths passed, ${checks} assertions, ${ledger.length} txs, ${gasUsed} gas = ${formatEther(gasCost)} tBNB`);
  writeReport(which, results, addrs, startBnb, endBnb);
  console.log(`report: ${reportFile(which)}`);
  if (failed.length) process.exitCode = 1;
}

function writeReport(which: string, results: { name: string; ok: boolean; detail: string }[], addrs: Address[], start: bigint[], end: bigint[]) {
  const gasCost = ledger.reduce((s, e) => s + e.cost, 0n);
  const L: string[] = [];
  L.push(`# KeyEscrow BSC testnet (97) ${which} run`, "");
  L.push(`- When: ${new Date().toISOString()}`, `- Command: \`pnpm ${which === "e2e" ? "e2e:testnet" : "testnet:seed"}\``);
  L.push(`- Factory [${deployment.escrowFactory}](${EXPLORER}/address/${deployment.escrowFactory}), token [${deployment.token}](${EXPLORER}/address/${deployment.token})`);
  L.push(`- Gas price ${formatUnits(GAS_PRICE, 9)} gwei (legacy, explicit), ${ledger.length} transactions, total gas cost **${formatEther(gasCost)} tBNB**`);
  L.push(`- ${checks} assertions; landlord-response and arbiter timeouts are not run on testnet (7/14 days of real time), they are covered on anvil by \`pnpm e2e:chain\``, "");
  L.push("## Result", "", "| Path | Result | Detail |", "| --- | --- | --- |");
  for (const r of results) L.push(`| ${r.name} | ${r.ok ? "PASS" : "**FAIL**"} | ${r.detail.replace(/\|/g, "\\|")} |`);
  L.push("", "## Leases", "", "| Path | Escrow |", "| --- | --- |");
  for (const l of leasesUsed) L.push(`| ${l.path} | [${l.escrow}](${EXPLORER}/address/${l.escrow}) |`);
  L.push("", "## Transactions", "", "| # | Section | Step | From | Gas used | Cost (tBNB) | Tx |", "| --- | --- | --- | --- | ---: | ---: | --- |");
  ledger.forEach((e, i) =>
    L.push(`| ${i + 1} | ${e.section} | ${e.step}${e.ok ? "" : " (REVERTED)"} | ${e.from} | ${e.gasUsed} | ${formatEther(e.cost)} | [${e.hash.slice(0, 10)}…](${EXPLORER}/tx/${e.hash}) |`),
  );
  L.push("", "## tBNB balances", "", "| Wallet | Address | Before | After |", "| --- | --- | ---: | ---: |");
  addrs.forEach((a, i) => L.push(`| ${label(a)} | [${a}](${EXPLORER}/address/${a}) | ${formatEther(start[i])} | ${formatEther(end[i])} |`));
  mkdirSync(path.dirname(reportFile(which)), { recursive: true });
  writeFileSync(reportFile(which), L.join("\n") + "\n");
}

async function cmdStatus() {
  await assertChain97();
  const w = loadTestWallets(false);
  const rows: [string, Address][] = [["deployer/desk", getAddress(need("DEPLOYER_ADDRESS"))]];
  if (w) rows.push(["landlord", w.landlord.address], ["tenant", w.tenant.address]);
  for (const [name, a] of rows) {
    const [bnb, usdt] = await Promise.all([pub.getBalance({ address: a }), tokenBalance(a)]);
    console.log(`${name.padEnd(14)} ${a}  ${formatEther(bnb)} tBNB  ${fmt(usdt)}`);
  }
  if (!w) console.log("(no test wallets yet: pnpm e2e:testnet creates them)");
}

const FUND_BNB = parseEther("0.01");
const FUND_USDT = USDT("10000"); // MockUSDT.FAUCET_LIMIT

async function cmdFund(target: string | undefined) {
  if (!target || !isAddress(target, { strict: false })) throw new Error("usage: pnpm testnet:fund <0x address>");
  const to = getAddress(target);
  if (to === zeroAddress) throw new Error("refusing the zero address");
  await assertChain97();
  if (((await pub.getCode({ address: to })) ?? "0x") !== "0x") throw new Error(`${to} is a contract on chain 97, not a wallet. Refusing.`);
  const deployer = loadDeployer();
  if (to === deployer.address) throw new Error("that is the deployer itself");
  names.set(deployer.address.toLowerCase(), "deployer");
  section = "fund";
  console.log(`Funding ${to} on BSC testnet (97): ${formatEther(FUND_BNB)} tBNB + ${fmt(FUND_USDT)} from the deployer`);
  await sendValue(`deployer -> ${to} ${formatEther(FUND_BNB)} tBNB`, deployer, to, FUND_BNB);
  await send(`faucet ${fmt(FUND_USDT)} -> ${to}`, deployer, deployment.token, tokenAbi, "faucet", [to, FUND_USDT]);
  const [bnb, usdt] = await Promise.all([pub.getBalance({ address: to, blockNumber: lastBlock }), tokenBalance(to)]);
  console.log(`${to} now holds ${formatEther(bnb)} tBNB and ${fmt(usdt)}. Add the token in the wallet: ${deployment.token} (6 decimals).`);
  console.log(`Deployer left: ${formatEther(await pub.getBalance({ address: deployer.address, blockNumber: lastBlock }))} tBNB`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "e2e" || cmd === "seed") return cmdRun(cmd);
  if (cmd === "status") return cmdStatus();
  if (cmd === "fund") return cmdFund(arg);
  throw new Error("usage: node web/scripts/testnet.mts e2e | seed | status | fund <address>");
}

main().catch((e) => {
  console.error(`testnet: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  process.exitCode = 1;
});
