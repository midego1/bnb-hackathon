import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { formatEther, formatGwei, getAddress, parseEventLogs, type Address, type Hash, type TransactionReceipt } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { escrowFactoryAbi, getDeployment } from "@/lib/contracts";
import { createChain97, gasPriceFrom, loadDeployer, loadWallets, parseEnvFile, TxStalledError, txUrl, type Chain97 } from "../chain97.mts";
import type { Env } from "../env";
import {
  assertAccounts,
  assertDemoChain,
  DEMO_CHAIN_ID,
  DEMO_ROLES,
  DemoError,
  demoTestnetConfig,
  gasLeft,
  RateLimiter,
  RunLock,
  topUpPlan,
  vetCall,
  type DemoAddresses,
  type DemoRole,
  type DemoTestnetConfig,
  type DemoTestnetPath,
  type RunState,
} from "./guards";

/**
 * Server-side runner of the live BSC testnet demo (/demo on a chain 97 build with DEMO_TESTNET_RUNNER=1). The browser
 * plays the same story as on the local chain, but instead of signing with anvil dev accounts it asks this runner to
 * sign each step's transaction with throwaway demo wallets whose keys live only in the server's secrets dir:
 *
 *   start(path)       takes the one-run lock (rate limited), tops the demo wallets up from the deployer if they are low
 *   tx(runId, call)   vets the call against the allowlist (guards.ts), signs it for chain 97 at the explicit gas price
 *                     within this run's gas cap, waits for the receipt and returns it (hash, status, logs)
 *   end(runId)        frees the lock and reports the gas this run burned
 *
 * Keys never leave this module: not in responses, not in logs. The demo wallets are created on first use in
 * <DEMO_TESTNET_SECRETS_DIR>/testnet-demo-wallets.json (mode 600); the deployer keystore (for top-ups only) is
 * decrypted in memory on the first top-up.
 */

const WALLETS_FILE = "testnet-demo-wallets.json";
const WALLETS_NOTE = "KeyEscrow BSC testnet (97) live-demo wallets (landlord, tenant, dispute desk). Testnet only. Never fund on mainnet. Never commit.";

type Loaded = {
  c97: Chain97;
  wallets: Record<DemoRole, PrivateKeyAccount>;
  addresses: DemoAddresses;
  deployerAddress: Address;
  secrets: Record<string, string>;
};

export type TxResult = {
  hash: Hash;
  url: string;
  status: "success" | "reverted";
  blockNumber: string;
  gasUsed: string;
  logs: { address: Address; topics: readonly Hash[]; data: Hash; logIndex: number | null }[];
};

export type TopUp = { role: DemoRole; amount: string; hash: Hash; url: string };

export class DemoTestnetRunner {
  readonly lock: RunLock;
  readonly rate: RateLimiter;
  private loaded?: Promise<Loaded>;
  private deployer?: PrivateKeyAccount;
  /** Every send goes through this queue, so two requests can never race for a nonce. */
  private queue: Promise<unknown> = Promise.resolve();
  private stalled?: { runId: string; key: string; hash: Hash };

  constructor(
    readonly cfg: DemoTestnetConfig,
    private readonly env: Env,
  ) {
    this.lock = new RunLock(cfg);
    this.rate = new RateLimiter(cfg);
  }

  private load(): Promise<Loaded> {
    this.loaded ??= (async () => {
      const file = this.cfg.envFile;
      const secrets = file && existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {};
      const pick = (k: string) => this.env[k] || secrets[k];
      const rpc = this.cfg.rpc || pick("BSC_TESTNET_RPC_URL");
      if (!rpc) throw new DemoError(503, "not-configured", "The live testnet demo has no BSC testnet RPC configured on this server.");
      const c97 = createChain97({ rpc, gasPrice: gasPriceFrom(this.cfg.gasPriceGwei), receiptTimeoutMs: this.cfg.receiptTimeoutMs });
      assertDemoChain(await c97.pub.getChainId());
      const w = loadWallets(path.join(this.cfg.secretsDir, WALLETS_FILE), DEMO_ROLES, { create: true, note: WALLETS_NOTE })!;
      const d = getDeployment(DEMO_CHAIN_ID);
      if (!d) throw new DemoError(503, "not-deployed", "KeyEscrow is not deployed on BSC testnet in this build.");
      const accounts = Object.fromEntries(DEMO_ROLES.map((r) => [r, w.accounts[r].address])) as Record<DemoRole, Address>;
      assertAccounts(accounts);
      const deployerAddress = pick("DEPLOYER_ADDRESS");
      if (!deployerAddress) throw new DemoError(503, "not-configured", "The live testnet demo has no deployer configured for gas top-ups.");
      return {
        c97,
        wallets: w.accounts,
        addresses: { factory: d.escrowFactory, token: d.mockUsdt, accounts },
        deployerAddress: getAddress(deployerAddress),
        secrets: { DEPLOYER_KEYSTORE: pick("DEPLOYER_KEYSTORE") ?? "", DEPLOYER_PASSWORD_FILE: pick("DEPLOYER_PASSWORD_FILE") ?? "", DEPLOYER_ADDRESS: deployerAddress },
      };
    })();
    this.loaded.catch(() => (this.loaded = undefined)); // a failed load (RPC down) is retried on the next request
    return this.loaded;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async status() {
    const l = await this.load();
    const now = Date.now();
    const run = this.lock.current(now);
    return {
      enabled: true as const,
      chainId: DEMO_CHAIN_ID,
      accounts: l.addresses.accounts,
      busy: !!run,
      waitSec: run ? 0 : this.rate.waitSec(now),
      gasPriceGwei: formatGwei(l.c97.gasPrice),
      maxGasPerRun: this.cfg.maxGasPerRun.toString(),
      maxCostTbnb: formatEther(this.cfg.maxGasPerRun * l.c97.gasPrice),
    };
  }

  async start(path: DemoTestnetPath) {
    const l = await this.load();
    const now = Date.now();
    if (this.lock.current(now)) this.lock.acquire("probe", path, now); // throws the friendly 409
    this.rate.check(now);
    const run = this.lock.acquire(randomUUID(), path, now);
    this.rate.record(now);
    try {
      const topUps = await this.serial(async () => {
        const out: TopUp[] = [];
        for (const role of DEMO_ROLES) {
          const t = await this.ensureGas(l, run, role);
          if (t) out.push(t);
        }
        return out;
      });
      console.log(`[demo-testnet] run ${run.id.slice(0, 8)} ${path} started${topUps.length ? `, topped up ${topUps.map((t) => t.role).join(", ")}` : ""}`);
      return { runId: run.id, path, accounts: l.addresses.accounts, topUps };
    } catch (e) {
      this.lock.release(run.id);
      throw e;
    }
  }

  /** Tops `role` up from the deployer when it runs low (within the cap), or refuses with a friendly message. */
  private async ensureGas(l: Loaded, run: RunState, role: DemoRole): Promise<TopUp | undefined> {
    const who = l.wallets[role].address;
    const [balance, deployerBalance] = await Promise.all([l.c97.pub.getBalance({ address: who }), l.c97.pub.getBalance({ address: l.deployerAddress })]);
    const plan = topUpPlan(balance, deployerBalance, this.cfg.topUp);
    if (plan.action === "none") return undefined;
    if (plan.action === "refuse") {
      console.warn(`[demo-testnet] top-up refused: deployer holds ${formatEther(deployerBalance)} tBNB`);
      throw new DemoError(503, "low-funds", plan.message);
    }
    this.deployer ??= loadDeployer(l.secrets);
    const hash = await l.c97.sendValue(this.deployer, who, plan.amount);
    const r = await this.receipt(l, run, hash, `top-up:${role}`);
    run.gasUsed += r.gasUsed;
    run.cost += r.gasUsed * r.effectiveGasPrice;
    console.log(`[demo-testnet] topped up ${role} ${formatEther(plan.amount)} tBNB: ${txUrl(hash)}`);
    return { role, amount: formatEther(plan.amount), hash, url: txUrl(hash) };
  }

  private async receipt(l: Loaded, run: RunState, hash: Hash, key: string): Promise<TransactionReceipt> {
    try {
      const r = await l.c97.wait(hash);
      if (this.stalled?.hash === hash) this.stalled = undefined;
      return r;
    } catch (e) {
      if (!(e instanceof TxStalledError)) throw e;
      this.stalled = { runId: run.id, key, hash };
      throw new DemoError(
        504,
        "stalled",
        `BSC testnet has not mined this transaction after ${Math.round(this.cfg.receiptTimeoutMs / 1000)} s. It may still go through: press Retry to keep waiting for it (${txUrl(hash)}).`,
      );
    }
  }

  async tx(runId: string, req: { role: string; address: string; data: string }): Promise<TxResult> {
    const l = await this.load();
    return this.serial(async () => {
      const run = this.lock.get(runId, Date.now());
      const key = `${req.role}:${req.address.toLowerCase()}:${req.data}`;
      let hash: Hash;
      let receipt: TransactionReceipt;
      if (this.stalled && this.stalled.runId === run.id && this.stalled.key === key) {
        // Retry of a stalled call: wait for the transaction already sent instead of sending it twice.
        hash = this.stalled.hash;
        receipt = await this.receipt(l, run, hash, key);
      } else {
        if (this.stalled?.runId === run.id) await this.receipt(l, run, this.stalled.hash, this.stalled.key); // keep the nonce order
        const call = vetCall(req, run, l.addresses);
        const maxGas = gasLeft(run, this.cfg);
        await this.ensureGas(l, run, call.role);
        try {
          ({ hash } = await l.c97.sendCall(l.wallets[call.role], call, { maxGas }));
        } catch (e) {
          if (e instanceof Error && e.name === "GasCapError") throw new DemoError(429, "gas-cap", "This step would go over the gas allowance of one live demo run. Start a new run.");
          throw e; // reverts surface as the contract's own error (friendlyError on the client)
        }
        run.txs++;
        receipt = await this.receipt(l, run, hash, key);
        if (call.functionName === "addEvidence") run.evidence++;
      }
      run.gasUsed += receipt.gasUsed;
      run.cost += receipt.gasUsed * receipt.effectiveGasPrice;
      if (!run.lease && receipt.status === "success") {
        const factoryLogs = receipt.logs.filter((g) => g.address.toLowerCase() === l.addresses.factory.toLowerCase());
        const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: factoryLogs });
        if (created) run.lease = getAddress((created.args as { escrow: Address }).escrow);
      }
      return {
        hash,
        url: txUrl(hash),
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        logs: receipt.logs.map((g) => ({ address: g.address, topics: g.topics, data: g.data, logIndex: g.logIndex })),
      };
    });
  }

  end(runId: string) {
    const run = this.lock.release(runId);
    if (!run) return { ended: false as const };
    console.log(`[demo-testnet] run ${run.id.slice(0, 8)} ${run.path} ended: ${run.txs} txs, ${run.gasUsed} gas, ${formatEther(run.cost)} tBNB`);
    return { ended: true as const, txs: run.txs, gasUsed: run.gasUsed.toString(), costTbnb: formatEther(run.cost), lease: run.lease };
  }
}

const KEY = Symbol.for("keyescrow.demoTestnetRunner");
type Holder = { [KEY]?: { sig: string; runner: DemoTestnetRunner } };

/**
 * The process-wide runner, or undefined when the live testnet demo is off (DEMO_TESTNET_RUNNER unset, another chain,
 * no secrets dir): the routes then answer 404. Kept on globalThis so dev-mode reloads keep the lock and rate limit.
 */
export function getDemoTestnetRunner(env: Env = process.env): DemoTestnetRunner | undefined {
  const cfg = demoTestnetConfig(env);
  if (!cfg) return undefined;
  const g = globalThis as Holder;
  const sig = JSON.stringify(cfg, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  if (g[KEY]?.sig !== sig) g[KEY] = { sig, runner: new DemoTestnetRunner(cfg, env) };
  return g[KEY].runner;
}
