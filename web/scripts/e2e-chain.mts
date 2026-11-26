/**
 * KeyScrow local-chain end-to-end checks.
 *
 *   pnpm e2e:chain            (from the repo root; or: node web/scripts/e2e-chain.mts)
 *
 * Starts a throwaway anvil on 127.0.0.1:28545 (override with E2E_ANVIL_PORT), deploys with
 * contracts/script/Deploy.s.sol, seeds with contracts/script/Seed.s.sol, then drives every settlement path
 * against the real chain and asserts token balances:
 *   seed      demo lease is funded and its content hashes match web/public/demo/*
 *   happy     create -> fund -> monthly rent releases -> proposal -> accept
 *   dispute   proposal -> dispute -> arbiter (KeyScrow dispute desk) resolves
 *   timeout   tenant proposal, landlord silent -> full deposit to tenant (exactly at the deadline)
 *   fallback  dispute, arbiter silent -> anyone returns the full deposit to the tenant (exactly at the deadline)
 * The anvil node is always killed at the end. Exit code is non-zero on any failure.
 *
 * LOCAL ONLY: the keys below are anvil's well-known public default dev keys.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  formatUnits,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACTS = path.join(ROOT, "contracts");
const DEMO_DIR = path.join(ROOT, "web/public/demo");
const DEPLOYMENTS_DIR = "deployments/.e2e"; // relative to contracts/, gitignored
const PORT = Number(process.env.E2E_ANVIL_PORT ?? 28545);
const RPC = `http://127.0.0.1:${PORT}`;

// Anvil default dev keys (public, local only): 0 deployer + treasury (fee recipient), 1 landlord, 2 tenant,
// 3 dispute desk (default arbiter), 4 keeper (an unrelated third party that triggers permissionless calls).
const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
] as const satisfies readonly Hex[];
const [deployer, landlord, tenant, desk, keeper] = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
const treasury = deployer;

// Amounts follow the deployed token's decimals() (read in main): 6 for MockUSDT.
let DECIMALS = 0;
const USDT = (v: string) => parseUnits(v, DECIMALS);
const fmt = (v: bigint) => `${formatUnits(v, DECIMALS)} mUSDT`;

// Demo scooter rental numbers (must match contracts/script/Seed.s.sol): 3,400 THB/month at ~34 THB per USDT.
let RENT = 0n;
let DEPOSIT = 0n;
const FEE_BPS = 1_000n;
let FEE = 0n; // 10% of ONE month, once per lease
const DAY = 86_400n;
const RENT_PERIOD = 30n * DAY;

// RentalEscrow.Status (a plain object, not a TS enum, so Node can run this file with type stripping).
const Status = { Created: 0, Active: 1, MoveOut: 2, Disputed: 3, Settled: 4, Cancelled: 5 } as const;

const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC);
const pub = createPublicClient({ chain, transport });
const testClient = createTestClient({ chain, transport, mode: "anvil" });
const wallet = (account: PrivateKeyAccount) => createWalletClient({ chain, transport, account });

function artifactAbi(file: string, name: string): Abi {
  const json = JSON.parse(readFileSync(path.join(CONTRACTS, "out", file, `${name}.json`), "utf8"));
  return json.abi as Abi;
}

// ---------------------------------------------------------------------------------------------------------
// Assertions & reporting
// ---------------------------------------------------------------------------------------------------------

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string) {
  const show = (v: T) => (typeof v === "bigint" ? `${v} (${fmt(v)})` : String(v));
  assert(actual === expected, `${msg}: expected ${show(expected)}, got ${show(actual)}`);
}

// ---------------------------------------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------------------------------------

interface Ctx {
  token: Address;
  factory: Address;
  tokenAbi: Abi;
  factoryAbi: Abi;
  escrowAbi: Abi;
}
let ctx: Ctx;

async function read<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
  return (await pub.readContract({ address, abi, functionName, args })) as T;
}

async function send(
  who: PrivateKeyAccount,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  gas?: bigint,
): Promise<TransactionReceipt> {
  const hash = await wallet(who).writeContract({ address, abi, functionName, args, gas });
  return pub.waitForTransactionReceipt({ hash });
}

async function ok(...a: Parameters<typeof send>) {
  const r = await send(...a);
  assert(r.status === "success", `${a[3]} should succeed`);
  return r;
}

/** Sends a real transaction with a fixed gas limit (no estimation) and expects it to revert with `error`. */
async function reverts(
  error: string,
  who: PrivateKeyAccount,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const r = await send(who, address, abi, functionName, args, 500_000n);
  assert(r.status === "reverted", `${functionName} should revert with ${error}`);
  const reason = await revertReason(r.transactionHash, abi);
  eq(reason, error, `${functionName} revert reason`);
  return r;
}

async function revertReason(hash: Hash, abi: Abi): Promise<string> {
  const trace = (await pub.request({
    method: "debug_traceTransaction" as never,
    params: [hash, { tracer: "callTracer" }] as never,
  })) as { output?: Hex };
  if (!trace.output || trace.output === "0x") return "<empty>";
  try {
    return decodeErrorResult({ abi, data: trace.output }).errorName;
  } catch {
    return `<undecodable ${trace.output}>`;
  }
}

async function blockTime(): Promise<bigint> {
  return (await pub.getBlock()).timestamp;
}

/** The next mined block (i.e. the next transaction) gets exactly this timestamp. */
async function setNextTimestamp(ts: bigint) {
  await testClient.setNextBlockTimestamp({ timestamp: ts });
}

const balance = (who: Address) => read<bigint>(ctx.token, ctx.tokenAbi, "balanceOf", [who]);

async function balances(escrow?: Address) {
  return {
    landlord: await balance(landlord.address),
    tenant: await balance(tenant.address),
    treasury: await balance(treasury.address),
    escrow: escrow ? await balance(escrow) : 0n,
  };
}
type Balances = Awaited<ReturnType<typeof balances>>;

function expectDeltas(before: Balances, after: Balances, d: Partial<Balances>, label: string) {
  for (const k of ["landlord", "tenant", "treasury", "escrow"] as const) {
    eq(after[k] - before[k], d[k] ?? 0n, `${label}: ${k} balance change`);
  }
}

async function status(escrow: Address) {
  return Number(await read<number>(escrow, ctx.escrowAbi, "status"));
}

async function createLease(opts: { arbiter?: Address; rentPeriod?: number } = {}): Promise<Address> {
  const r = await ok(landlord, ctx.factory, ctx.factoryAbi, "createLease", [
    {
      tenant: tenant.address,
      arbiter: opts.arbiter ?? zeroAddress, // zero = KeyScrow dispute desk
      rentAmount: RENT,
      depositAmount: DEPOSIT,
      termPeriods: 12,
      rentPeriod: opts.rentPeriod ?? 0, // 0 = monthly (30 days)
      responseWindow: 0, // default 7 days
      arbiterWindow: 0, // default 14 days
      leaseHash: keccak256(toHex("e2e lease")),
    },
  ]);
  const [ev] = parseEventLogs({ abi: ctx.factoryAbi, logs: r.logs, eventName: "LeaseCreated" });
  const escrow = (ev as unknown as { args: { escrow: Address } }).args.escrow;
  return escrow;
}

async function fund(escrow: Address, extraMonths = 0n) {
  await ok(tenant, ctx.token, ctx.tokenAbi, "approve", [escrow, DEPOSIT + RENT * (1n + extraMonths)]);
  await ok(tenant, escrow, ctx.escrowAbi, "fund");
  if (extraMonths > 0n) await ok(tenant, escrow, ctx.escrowAbi, "payRent", [Number(extraMonths)]);
  eq(await status(escrow), Status.Active, "status after funding");
}

const sha256 = (file: string) => `0x${createHash("sha256").update(readFileSync(file)).digest("hex")}`;

// ---------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------

async function checkSeed() {
  const demo = JSON.parse(readFileSync(path.join(CONTRACTS, DEPLOYMENTS_DIR, "31337.demo.json"), "utf8"));
  const lease = demo.lease as Address;
  const terms = await read<Record<string, unknown>>(lease, ctx.escrowAbi, "terms");

  eq(await status(lease), Status.Active, "demo lease status");
  eq(await read<number>(lease, ctx.escrowAbi, "periodsFunded"), 1, "demo lease periodsFunded");
  eq(await balance(lease), DEPOSIT + RENT, "demo escrow holds deposit + first month");
  eq(terms.landlord, landlord.address, "demo landlord = anvil #1");
  eq(terms.tenant, tenant.address, "demo tenant = anvil #2");
  eq(terms.arbiter, desk.address, "demo arbiter = dispute desk (anvil #3)");
  eq(terms.rentAmount, RENT, "demo rent (3,400 THB)");
  eq(terms.depositAmount, DEPOSIT, "demo deposit (2 months)");
  eq(terms.feeBps, Number(FEE_BPS), "demo fee bps");
  eq(terms.feeRecipient, treasury.address, "demo fee recipient = treasury (anvil #0)");
  eq(terms.responseWindow, Number(7n * DAY), "demo response window");
  eq(terms.arbiterWindow, Number(14n * DAY), "demo arbiter window");

  eq(terms.leaseHash, sha256(path.join(DEMO_DIR, "lease.pdf")), "leaseHash = sha256(lease.pdf)");
  eq(
    await read<Hex>(lease, ctx.escrowAbi, "checkInHash"),
    sha256(path.join(DEMO_DIR, "checkin-manifest.json")),
    "checkInHash = sha256(checkin-manifest.json)",
  );
  const manifest = JSON.parse(readFileSync(path.join(DEMO_DIR, "checkin-manifest.json"), "utf8"));
  for (const p of manifest.photos as { file: string; sha256: string }[]) {
    eq(sha256(path.join(DEMO_DIR, p.file)), p.sha256, `manifest hash of ${p.file}`);
  }
  const byTenant = await read<Address[]>(ctx.factory, ctx.factoryAbi, "leasesByTenant", [tenant.address]);
  assert(byTenant.includes(lease), "factory indexes the demo lease by tenant");

  // Second demo lease, already disputed, for the dispute-desk scene. Its 60-day arbiter window outlasts a +30 day jump.
  const disputed = demo.disputedLease as Address;
  eq(await status(disputed), Status.Disputed, "disputed demo lease status");
  const dTerms = await read<Record<string, unknown>>(disputed, ctx.escrowAbi, "terms");
  eq(dTerms.arbiterWindow, Number(60n * DAY), "disputed demo lease arbiter window");
  eq(await balance(disputed), DEPOSIT + RENT, "disputed escrow holds deposit + first month");
  const dp = await read<{ landlordClaim: bigint; proposer: Address }>(disputed, ctx.escrowAbi, "proposal");
  eq(dp.landlordClaim, USDT("50"), "disputed demo lease landlord (owner) claim");
  eq(dp.proposer, landlord.address, "disputed demo lease proposer");
  assert(byTenant.includes(disputed), "factory indexes the disputed demo lease by tenant");
  return `lease ${lease}: ${fmt(RENT)}/month, ${fmt(DEPOSIT)} deposit, hashes match web/public/demo; disputed lease ${disputed}`;
}

async function happyPath() {
  const escrow = await createLease();
  await fund(escrow, 2n); // months 0..2 funded
  const t0 = await read<bigint>(escrow, ctx.escrowAbi, "startTime");

  // Month 1 (index 0): due at funding; keeper releases it. One-time fee goes to the treasury.
  let before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "releaseRent");
  expectDeltas(before, await balances(escrow), { landlord: RENT - FEE, treasury: FEE, escrow: -RENT }, "month 1");

  // Month 2 is not due yet for a third party...
  await reverts("NothingToRelease", keeper, escrow, ctx.escrowAbi, "releaseRent");
  // ...until its due date. No fee on later months.
  await setNextTimestamp(t0 + RENT_PERIOD);
  before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "releaseRent");
  expectDeltas(before, await balances(escrow), { landlord: RENT, escrow: -RENT }, "month 2");

  // Return: renter (tenant) anchors return photos and submits the AI proposal (30 mUSDT for a cracked mirror).
  const claim = USDT("30");
  await ok(tenant, escrow, ctx.escrowAbi, "addEvidence", [1, keccak256(toHex("checkout-manifest"))]);
  await ok(tenant, escrow, ctx.escrowAbi, "propose", [DEPOSIT - claim, keccak256(toHex("ai-report"))]);
  eq(await status(escrow), Status.MoveOut, "status after proposal");
  await reverts("ProposerCannotAccept", tenant, escrow, ctx.escrowAbi, "accept", [1]);

  before = await balances(escrow);
  await ok(landlord, escrow, ctx.escrowAbi, "accept", [1]);
  // Month 3 was prepaid but not due -> back to the tenant along with the agreed refund.
  expectDeltas(
    before,
    await balances(escrow),
    { landlord: claim, tenant: DEPOSIT - claim + RENT, escrow: -(DEPOSIT + RENT) },
    "settlement",
  );
  eq(await status(escrow), Status.Settled, "status after accept");
  return `landlord got 2 months - fee (${fmt(FEE)}) + ${fmt(claim)} claim; tenant got ${fmt(DEPOSIT - claim)} + prepaid month`;
}

/** Weekly rent: periods fall due every 7 days, the fee is 10% of the monthly equivalent, and the rent clock stops at the return. */
async function weeklyPath() {
  const WEEK = 7n * DAY;
  const escrow = await createLease({ rentPeriod: Number(WEEK) });
  await fund(escrow, 2n); // weeks 0..2 funded
  const t0 = await read<bigint>(escrow, ctx.escrowAbi, "startTime");
  const fee = (RENT * 30n * FEE_BPS) / (7n * 10_000n); // 10% of RENT x 30/7

  let before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "releaseRent");
  expectDeltas(before, await balances(escrow), { landlord: RENT - fee, treasury: fee, escrow: -RENT }, "week 1");
  await setNextTimestamp(t0 + WEEK);
  before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "releaseRent");
  expectDeltas(before, await balances(escrow), { landlord: RENT, escrow: -RENT }, "week 2");

  // Return on day 10; the owner stays silent for the whole 7-day window, past week 3's due date (day 14).
  await setNextTimestamp(t0 + 10n * DAY);
  await ok(tenant, escrow, ctx.escrowAbi, "propose", [DEPOSIT, keccak256(toHex("weekly report"))]);
  await setNextTimestamp(t0 + 17n * DAY);
  before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "claimTimeout");
  // Week 3 fell due after the return: refunded with the full deposit.
  expectDeltas(before, await balances(escrow), { tenant: DEPOSIT + RENT, escrow: -(DEPOSIT + RENT) }, "weekly settlement");
  eq(await read<bigint>(ctx.factory, ctx.factoryAbi, "activeValue"), await liveValue(), "factory activeValue = funds still in escrows");
  return `fee ${fmt(fee)} (10% of ${fmt((RENT * 30n) / 7n)}/month equivalent); week 3, due after the return, refunded`;
}

/** Everything still held by the escrows this run created (the factory's pilot-cap book must match it). */
async function liveValue() {
  const all = await read<Address[]>(ctx.factory, ctx.factoryAbi, "leases", [0n, 1000n]);
  let sum = 0n;
  for (const a of all) sum += await balance(a);
  return sum;
}

async function disputePath() {
  const escrow = await createLease();
  await fund(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "releaseRent");

  await ok(landlord, escrow, ctx.escrowAbi, "propose", [0n, keccak256(toHex("landlord claims all"))]);
  await ok(tenant, escrow, ctx.escrowAbi, "dispute");
  eq(await status(escrow), Status.Disputed, "status after dispute");
  await reverts("Unauthorized", landlord, escrow, ctx.escrowAbi, "resolve", [DEPOSIT, keccak256(toHex("x"))]);

  const award = USDT("150");
  const before = await balances(escrow);
  await ok(desk, escrow, ctx.escrowAbi, "resolve", [DEPOSIT - award, keccak256(toHex("ruling"))]);
  expectDeltas(
    before,
    await balances(escrow),
    { landlord: award, tenant: DEPOSIT - award, escrow: -DEPOSIT },
    "arbiter ruling",
  );
  eq(await status(escrow), Status.Settled, "status after ruling");
  eq(await balance(escrow), 0n, "escrow empty");
  return `dispute desk awarded landlord ${fmt(award)}, tenant ${fmt(DEPOSIT - award)}`;
}

async function landlordTimeoutPath() {
  const escrow = await createLease();
  await fund(escrow);

  // Tenant offers the landlord 100 mUSDT; the landlord never answers.
  await ok(tenant, escrow, ctx.escrowAbi, "propose", [DEPOSIT - USDT("100"), keccak256(toHex("ai-report"))]);
  const deadline = await read<bigint>(escrow, ctx.escrowAbi, "timeoutAt");
  eq(deadline - (await blockTime()), 7n * DAY, "default response window is 7 days");

  await setNextTimestamp(deadline - 1n);
  await reverts("TimeoutNotReached", keeper, escrow, ctx.escrowAbi, "claimTimeout");

  await setNextTimestamp(deadline);
  const before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "claimTimeout");
  // FULL deposit to the tenant (not the proposed split); month 1 rent was due -> landlord minus one-time fee.
  expectDeltas(
    before,
    await balances(escrow),
    { tenant: DEPOSIT, landlord: RENT - FEE, treasury: FEE, escrow: -(DEPOSIT + RENT) },
    "landlord timeout",
  );
  eq(await status(escrow), Status.Settled, "status after timeout");
  await reverts("InvalidStatus", keeper, escrow, ctx.escrowAbi, "claimTimeout");
  return `reverted at deadline-1s, settled at deadline: tenant +${fmt(DEPOSIT)} (full), double trigger reverts`;
}

async function arbiterFallbackPath() {
  const escrow = await createLease();
  await fund(escrow, 1n); // months 0 and 1 funded
  let before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "releaseRent"); // month 1 (index 0) released before the dispute
  expectDeltas(before, await balances(escrow), { landlord: RENT - FEE, treasury: FEE, escrow: -RENT }, "release");

  await ok(landlord, escrow, ctx.escrowAbi, "propose", [0n, keccak256(toHex("landlord claims all"))]);
  await ok(tenant, escrow, ctx.escrowAbi, "dispute");
  const deadline = await read<bigint>(escrow, ctx.escrowAbi, "arbiterDeadline");
  eq(deadline - (await blockTime()), 14n * DAY, "default arbiter window is 14 days");

  await setNextTimestamp(deadline - 1n);
  await reverts("TimeoutNotReached", keeper, escrow, ctx.escrowAbi, "claimArbiterTimeout");

  await setNextTimestamp(deadline);
  await reverts("ArbiterDeadlinePassed", desk, escrow, ctx.escrowAbi, "resolve", [0n, keccak256(toHex("late"))]);

  before = await balances(escrow);
  await ok(keeper, escrow, ctx.escrowAbi, "claimArbiterTimeout");
  // Released rent stays with the landlord; prepaid month 2 (not due after 14 days) + full deposit -> tenant.
  expectDeltas(
    before,
    await balances(escrow),
    { tenant: DEPOSIT + RENT, escrow: -(DEPOSIT + RENT) },
    "arbiter fallback",
  );
  eq(await status(escrow), Status.Settled, "status after fallback");
  await reverts("InvalidStatus", keeper, escrow, ctx.escrowAbi, "claimArbiterTimeout");
  return `fallback reverted at deadline-1s, arbiter locked out at deadline, tenant +${fmt(DEPOSIT)} + prepaid month`;
}

// ---------------------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------------------

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

async function waitForRpc() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await pub.getChainId()) === 31337) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not come up on ${RPC}`);
}

function forgeScript(script: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEPLOYMENTS_DIR,
    // Pin every knob so a developer's shell or .env cannot change the run.
    PRIVATE_KEY: ANVIL_KEYS[0],
    FEE_BPS: String(FEE_BPS),
    FEE_RECIPIENT: treasury.address,
    DEFAULT_ARBITER: desk.address,
    FACTORY_OWNER: deployer.address,
    TOKEN_ADDRESS: zeroAddress,
    ALLOW_NON_LOCAL_BROADCAST: "false",
  };
  const r = spawnSync("forge", ["script", script, "--rpc-url", RPC, "--broadcast"], {
    cwd: CONTRACTS,
    env,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`forge script ${script} failed:\n${(r.stdout + r.stderr).split("\n").slice(-40).join("\n")}`);
  }
}

async function main() {
  if (await portInUse(PORT)) {
    throw new Error(`port ${PORT} is already in use; refusing to reuse a node that this runner did not start`);
  }
  rmSync(path.join(CONTRACTS, DEPLOYMENTS_DIR), { recursive: true, force: true });

  const anvil: ChildProcess = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(PORT), "--chain-id", "31337", "--silent"],
    { stdio: "ignore" },
  );
  const stop = () => anvil.exitCode === null && anvil.kill("SIGTERM");
  process.once("SIGINT", () => (stop(), process.exit(130)));
  process.once("SIGTERM", () => (stop(), process.exit(143)));

  const results: { name: string; ok: boolean; detail: string }[] = [];
  try {
    await waitForRpc();
    console.log(`anvil up on ${RPC} (chain 31337)`);

    forgeScript("script/Deploy.s.sol");
    const deployment = JSON.parse(readFileSync(path.join(CONTRACTS, DEPLOYMENTS_DIR, "31337.json"), "utf8"));
    ctx = {
      token: deployment.token,
      factory: deployment.escrowFactory,
      tokenAbi: artifactAbi("MockUSDT.sol", "MockUSDT"),
      factoryAbi: artifactAbi("EscrowFactory.sol", "EscrowFactory"),
      escrowAbi: artifactAbi("RentalEscrow.sol", "RentalEscrow"),
    };
    DECIMALS = await read<number>(ctx.token, ctx.tokenAbi, "decimals");
    eq(deployment.tokenDecimals, DECIMALS, "deployment file tokenDecimals = token.decimals()");
    RENT = USDT("100");
    DEPOSIT = 2n * RENT;
    FEE = (RENT * FEE_BPS) / 10_000n;
    eq(await read<Address>(ctx.factory, ctx.factoryAbi, "defaultArbiter"), desk.address, "dispute desk");
    eq(await read<Address>(ctx.factory, ctx.factoryAbi, "feeRecipient"), treasury.address, "treasury");
    console.log(`deployed  MockUSDT ${ctx.token}  EscrowFactory ${ctx.factory}`);

    forgeScript("script/Seed.s.sol");
    console.log("seeded    demo landlord/tenant/arbiter + funded demo lease");

    const paths: [string, () => Promise<string>][] = [
      ["seed", checkSeed],
      ["happy", happyPath],
      ["weekly", weeklyPath],
      ["dispute", disputePath],
      ["timeout", landlordTimeoutPath],
      ["fallback", arbiterFallbackPath],
    ];
    for (const [name, fn] of paths) {
      try {
        const detail = await fn();
        results.push({ name, ok: true, detail });
        console.log(`  PASS  ${name.padEnd(9)} ${detail}`);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        results.push({ name, ok: false, detail });
        console.log(`  FAIL  ${name.padEnd(9)} ${detail}`);
      }
    }
  } finally {
    stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} paths passed, ${checks} assertions` +
      (failed.length ? `; FAILED: ${failed.map((f) => f.name).join(", ")}` : ""),
  );
  if (failed.length || results.length === 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`e2e:chain error: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});

