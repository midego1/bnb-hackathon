import { decodeFunctionData, getAddress, isAddress, isHex, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import type { Env } from "../env";

/**
 * Pure guards of the live BSC testnet demo runner (lib/server/demoTestnet/runner.ts): who may switch it on, one run at
 * a time, how often, how much gas, when to top a wallet up, and which contract calls the server will sign. No I/O here,
 * so every rule is unit-tested (tests/demo-testnet-guards.test.ts).
 */

export const DEMO_CHAIN_ID = 97;
export type DemoRole = "landlord" | "tenant" | "arbiter";
export const DEMO_ROLES: readonly DemoRole[] = ["landlord", "tenant", "arbiter"];
export type DemoTestnetPath = "happy" | "dispute";

// ---------------------------------------------------------------------------------------------------------
// Config: off unless DEMO_TESTNET_RUNNER=1 on a chain 97 build
// ---------------------------------------------------------------------------------------------------------

export type DemoTestnetConfig = {
  secretsDir: string;
  /** dotenv file with BSC_TESTNET_RPC_URL and the DEPLOYER_* keystore settings (the repo-root .env). */
  envFile?: string;
  rpc?: string;
  gasPriceGwei?: string;
  minGapMs: number;
  runsPerHour: number;
  maxGasPerRun: bigint;
  maxTxsPerRun: number;
  idleMs: number;
  maxRunMs: number;
  receiptTimeoutMs: number;
  /** Top a demo wallet up when it holds less than `floor`, by `amount` (never more than TOP_UP_CAP). */
  topUp: { floor: bigint; amount: bigint; deployerFloor: bigint };
};

/** Hard ceiling on one top-up, whatever the env says. */
export const TOP_UP_CAP = parseEther("0.005");
/** The deployer is never drained below this. */
export const DEPLOYER_FLOOR_MIN = parseEther("0.05");

const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, Math.floor(n))) : d;
};

/**
 * The runner exists only with DEMO_TESTNET_RUNNER=1 AND NEXT_PUBLIC_CHAIN_ID=97 AND a secrets dir. Anything else:
 * `undefined`, and every /api/demo-testnet route answers 404.
 */
export function demoTestnetConfig(env: Env): DemoTestnetConfig | undefined {
  if (env.DEMO_TESTNET_RUNNER !== "1") return undefined;
  if (Number(env.NEXT_PUBLIC_CHAIN_ID) !== DEMO_CHAIN_ID) return undefined;
  const secretsDir = env.DEMO_TESTNET_SECRETS_DIR;
  if (!secretsDir) return undefined;
  const topUpAmount = (() => {
    try {
      const v = env.DEMO_TESTNET_TOP_UP_TBNB ? parseEther(env.DEMO_TESTNET_TOP_UP_TBNB) : TOP_UP_CAP;
      return v > TOP_UP_CAP || v <= BigInt(0) ? TOP_UP_CAP : v;
    } catch {
      return TOP_UP_CAP;
    }
  })();
  return {
    secretsDir,
    envFile: env.DEMO_TESTNET_ENV_FILE || undefined,
    rpc: env.DEMO_TESTNET_RPC_URL || undefined,
    gasPriceGwei: env.TESTNET_GAS_PRICE_GWEI || undefined,
    minGapMs: int(env.DEMO_TESTNET_MIN_GAP_S, 60, 10, 3600) * 1000,
    runsPerHour: int(env.DEMO_TESTNET_RUNS_PER_HOUR, 12, 1, 60),
    maxGasPerRun: BigInt(int(env.DEMO_TESTNET_MAX_GAS_PER_RUN, 2_500_000, 500_000, 5_000_000)),
    maxTxsPerRun: 20,
    idleMs: 120_000,
    maxRunMs: 15 * 60_000,
    receiptTimeoutMs: int(env.DEMO_TESTNET_TX_TIMEOUT_S, 45, 10, 180) * 1000,
    topUp: { floor: parseEther("0.002"), amount: topUpAmount, deployerFloor: DEPLOYER_FLOOR_MIN },
  };
}

/** The RPC the runner signs against must answer 97; anything else is refused before a key is touched. */
export function assertDemoChain(chainId: number) {
  if (chainId !== DEMO_CHAIN_ID) throw new DemoError(503, "wrong-chain", `The demo RPC answers chain ${chainId}, not BSC testnet (97). Refusing to sign.`);
}

export class DemoError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec?: number;
  constructor(status: number, code: string, message: string, retryAfterSec?: number) {
    super(message);
    this.name = "DemoError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

// ---------------------------------------------------------------------------------------------------------
// One run at a time, a minimum gap between runs and an hourly cap
// ---------------------------------------------------------------------------------------------------------

export type RunState = {
  id: string;
  path: DemoTestnetPath;
  startedAt: number;
  lastSeen: number;
  gasUsed: bigint;
  cost: bigint;
  txs: number;
  evidence: number;
  lease?: Address;
};

export class RunLock {
  private run: RunState | undefined;
  constructor(private readonly limits: Pick<DemoTestnetConfig, "idleMs" | "maxRunMs">) {}

  /** The run holding the lock, or undefined once it went idle or ran out of time (the lock then frees itself). */
  current(now: number): RunState | undefined {
    const r = this.run;
    if (r && (now - r.lastSeen > this.limits.idleMs || now - r.startedAt > this.limits.maxRunMs)) this.run = undefined;
    return this.run;
  }

  acquire(id: string, path: DemoTestnetPath, now: number): RunState {
    const busy = this.current(now);
    if (busy) {
      const wait = Math.max(1, Math.ceil((busy.lastSeen + this.limits.idleMs - now) / 1000));
      throw new DemoError(409, "busy", "Someone else is playing the live testnet demo right now. Try again in a minute.", Math.min(wait, 60));
    }
    this.run = { id, path, startedAt: now, lastSeen: now, gasUsed: BigInt(0), cost: BigInt(0), txs: 0, evidence: 0 };
    return this.run;
  }

  /** The caller's run, refreshed; throws when it is not (or no longer) the lock holder. */
  get(id: string, now: number): RunState {
    const r = this.current(now);
    if (!r || r.id !== id) throw new DemoError(410, "run-gone", "This live demo run has ended (it was idle too long). Start a new one.");
    r.lastSeen = now;
    return r;
  }

  release(id: string): RunState | undefined {
    if (this.run?.id !== id) return undefined;
    const r = this.run;
    this.run = undefined;
    return r;
  }
}

export class RateLimiter {
  private starts: number[] = [];
  constructor(private readonly limits: Pick<DemoTestnetConfig, "minGapMs" | "runsPerHour">) {}

  /** Seconds until the next run may start (0 = now). */
  waitSec(now: number): number {
    this.starts = this.starts.filter((t) => now - t < 3_600_000);
    const last = this.starts.at(-1);
    let until = last === undefined ? now : last + this.limits.minGapMs;
    if (this.starts.length >= this.limits.runsPerHour) until = Math.max(until, this.starts[0] + 3_600_000);
    return Math.max(0, Math.ceil((until - now) / 1000));
  }

  check(now: number) {
    const wait = this.waitSec(now);
    if (wait > 0) {
      const hourly = this.starts.length >= this.limits.runsPerHour;
      throw new DemoError(
        429,
        "rate-limited",
        hourly
          ? `The live testnet demo has run ${this.limits.runsPerHour} times this hour. It is free again in about ${Math.ceil(wait / 60)} min; the local demo has no limit.`
          : `The live testnet demo just ran. It is free again in ${wait} s.`,
        wait,
      );
    }
  }

  record(now: number) {
    this.starts.push(now);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Gas: a hard cap per run, and topping demo wallets up from the deployer within a small cap
// ---------------------------------------------------------------------------------------------------------

/** Gas still allowed for this run; a tx whose estimate exceeds it is refused before it is signed. */
export function gasLeft(run: RunState, cfg: Pick<DemoTestnetConfig, "maxGasPerRun" | "maxTxsPerRun">): bigint {
  if (run.txs >= cfg.maxTxsPerRun) throw new DemoError(429, "tx-cap", `This run already sent ${cfg.maxTxsPerRun} transactions, the most one live demo may send.`);
  const left = cfg.maxGasPerRun - run.gasUsed;
  if (left <= BigInt(0)) throw new DemoError(429, "gas-cap", "This run used up its gas allowance on BSC testnet. Start a new run.");
  return left;
}

export type TopUpPlan = { action: "none" } | { action: "top-up"; amount: bigint } | { action: "refuse"; message: string };

/**
 * A demo wallet below `floor` gets `amount` (capped at TOP_UP_CAP) from the deployer, unless that would leave the
 * deployer under its floor (never below DEPLOYER_FLOOR_MIN): then the run is refused with a friendly message.
 */
export function topUpPlan(balance: bigint, deployerBalance: bigint, t: DemoTestnetConfig["topUp"]): TopUpPlan {
  if (balance >= t.floor) return { action: "none" };
  const amount = t.amount > TOP_UP_CAP ? TOP_UP_CAP : t.amount;
  const floor = t.deployerFloor < DEPLOYER_FLOOR_MIN ? DEPLOYER_FLOOR_MIN : t.deployerFloor;
  if (deployerBalance - amount < floor) {
    return {
      action: "refuse",
      message: "The live testnet demo is out of test BNB for gas right now. Play it on the local demo, or ask the team to refill the testnet faucet wallet.",
    };
  }
  return { action: "top-up", amount };
}

// ---------------------------------------------------------------------------------------------------------
// The calls the server signs: an allowlist, checked against this run's lease and the demo wallets
// ---------------------------------------------------------------------------------------------------------

export type DemoAddresses = { factory: Address; token: Address; accounts: Record<DemoRole, Address> };
type DemoAbi = typeof escrowFactoryAbi | typeof mockUsdtAbi | typeof rentalEscrowAbi;
export type SignedCall = { role: DemoRole; address: Address; abi: DemoAbi; functionName: string; args: readonly unknown[] };

const MUSDT = BigInt(1_000_000);
/** Per-call ceilings in mUSDT base units: a demo lease is a few hundred dollars a month. */
const MAX_RENT = BigInt(5_000) * MUSDT;
const MAX_DEPOSIT = BigInt(15_000) * MUSDT;
const MAX_MINT = BigInt(10_000) * MUSDT; // MockUSDT.FAUCET_LIMIT
const MAX_EVIDENCE_PER_RUN = 8;

const refuse = (msg: string): never => {
  throw new DemoError(400, "call-refused", msg);
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Turns a browser request {role, address, data} into a call the server will sign, or refuses it. Only the demo's own
 * steps pass: createLease between the demo landlord and tenant with the demo dispute desk, the tenant's faucet and
 * approve for this run's lease, and the lease calls of the happy and dispute stories (no claimTimeout: it needs days).
 */
export function vetCall(req: { role: string; address: string; data: string }, run: RunState, a: DemoAddresses): SignedCall {
  if (!DEMO_ROLES.includes(req.role as DemoRole)) refuse(`Unknown demo role "${req.role}".`);
  const role = req.role as DemoRole;
  if (!isAddress(req.address, { strict: false })) refuse("Not a contract address.");
  if (!isHex(req.data) || req.data.length < 10) refuse("Missing call data.");
  const address = getAddress(req.address);
  const data = req.data as Hex;
  const me = a.accounts[role];

  if (same(address, a.factory)) {
    const { functionName, args } = decodeOrRefuse(escrowFactoryAbi, data);
    if (functionName !== "createLease") refuse(`The demo does not call factory.${functionName}.`);
    if (role !== "landlord") refuse("Only the demo landlord creates the lease.");
    if (run.lease) refuse("This run already created its lease.");
    const p = (args as readonly [{ tenant: Address; arbiter: Address; rentAmount: bigint; depositAmount: bigint; termMonths: number }])[0];
    if (!same(p.tenant, a.accounts.tenant)) refuse("The lease tenant must be the demo tenant.");
    if (!same(p.arbiter, a.accounts.arbiter)) refuse("The lease referee must be the demo dispute desk.");
    if (p.rentAmount > MAX_RENT || p.depositAmount > MAX_DEPOSIT) refuse("Demo rent or deposit too large.");
    return { role, address, abi: escrowFactoryAbi, functionName, args };
  }

  if (same(address, a.token)) {
    const { functionName, args } = decodeOrRefuse(mockUsdtAbi, data);
    if (role !== "tenant") refuse("Only the demo tenant uses MockUSDT in the demo.");
    if (functionName === "faucet") {
      const [to, amount] = args as readonly [Address, bigint];
      if (!same(to, me)) refuse("The demo faucet only mints to the demo tenant.");
      if (amount > MAX_MINT) refuse("Faucet amount over the MockUSDT limit.");
    } else if (functionName === "approve") {
      const [spender, amount] = args as readonly [Address, bigint];
      if (!run.lease || !same(spender, run.lease)) refuse("The tenant only approves this run's escrow.");
      if (amount > MAX_DEPOSIT + MAX_RENT) refuse("Approval too large.");
    } else refuse(`The demo does not call token.${functionName}.`);
    return { role, address, abi: mockUsdtAbi, functionName, args };
  }

  if (run.lease && same(address, run.lease)) {
    const { functionName, args } = decodeOrRefuse(rentalEscrowAbi, data);
    const allowed: Record<string, DemoRole[]> = {
      addEvidence: ["landlord", "tenant"],
      fund: ["tenant"],
      releaseRent: ["landlord", "tenant"],
      propose: ["landlord", "tenant"],
      accept: ["landlord", "tenant"],
      dispute: ["landlord", "tenant"],
      resolve: ["arbiter"],
    };
    const who = allowed[functionName];
    if (!who) refuse(`The live demo does not call ${functionName} (it needs days of real time or is not part of the story).`);
    if (!who!.includes(role)) refuse(`The demo ${role} does not call ${functionName}.`);
    if (functionName === "addEvidence" && run.evidence >= MAX_EVIDENCE_PER_RUN) refuse("Enough photos on record for one run.");
    return { role, address, abi: rentalEscrowAbi, functionName, args };
  }

  return refuse(run.lease ? "That contract is not part of this demo run." : "Create the lease first.");
}

function decodeOrRefuse(abi: DemoAbi, data: Hex) {
  try {
    return decodeFunctionData({ abi, data }) as { functionName: string; args: readonly unknown[] };
  } catch {
    return refuse("Call data does not match the contract.");
  }
}

/** The zero address is never a demo actor (guards a half-loaded wallet file). */
export function assertAccounts(accounts: Record<DemoRole, Address>) {
  for (const r of DEMO_ROLES) if (!accounts[r] || same(accounts[r], zeroAddress)) throw new DemoError(503, "no-wallets", `Demo ${r} wallet missing.`);
}
