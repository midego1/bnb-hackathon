import { formatEther, formatGwei, formatUnits, getAddress, parseEventLogs, type Address, type Hash, type Hex, type TransactionReceipt } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { escrowFactoryAbi, getDeployment, mockUsdtAbi, rentalEscrowAbi, TOKEN } from "@/lib/contracts";
import { createChain97, gasPriceFrom, TxStalledError, txUrl, type Chain97 } from "../chain97.mts";
import type { Env } from "../env";
import {
  assertAccounts,
  assertDedicatedDesk,
  assertDemoChain,
  DEMO_CHAIN_ID,
  DEMO_ROLES,
  DemoError,
  demoTestnetConfig,
  gasLeft,
  LOW_FUNDS_MESSAGE,
  topUpPlan,
  vetCall,
  vetRead,
  vetResumeLease,
  type DemoAddresses,
  type DemoRole,
  type DemoTestnetConfig,
  type DemoTestnetPath,
  type RunState,
} from "./guards";
import { planOnRamp } from "../onramp";
import { loadDemoSecrets, type DemoSecrets, type DemoSecretsSource } from "./keys";
import { MemoryRunStore, type DemoRunStore } from "./store";

/**
 * Server-side runner of the live BSC testnet demo (/demo on a chain 97 build with DEMO_TESTNET_RUNNER=1). The browser
 * plays the same story as on the local chain, but instead of signing with anvil dev accounts it asks this runner to
 * sign each step's transaction with throwaway demo wallets whose keys exist only on the server:
 *
 *   start(path)       takes the one-run lock (rate limited), tops the demo wallets up from the funder if they are low
 *   tx(runId, call)   vets the call against the allowlist (guards.ts), signs it for chain 97 at the explicit gas price
 *                     within this run's gas cap, waits for the receipt and returns it (hash, status, logs)
 *   end(runId)        frees the lock and reports the gas this run burned
 *
 * Two seams keep it portable (Node `next start` today, Cloudflare Workers later):
 *   keys   one loader, keys.ts `loadDemoSecrets`: env vars on Workers, the secrets dir locally
 *   state  the lock, rate limit and run state behind store.ts `DemoRunStore`: in memory here, a Durable Object there
 * The dispute desk is a dedicated demo wallet named per lease, never the deployer (asserted on load).
 *
 * Keys never leave the server: not in responses, not in logs.
 */

type Loaded = {
  c97: Chain97;
  wallets: Record<DemoRole, PrivateKeyAccount>;
  addresses: DemoAddresses;
  funder?: DemoSecrets["funder"];
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
  private loaded?: Promise<Loaded>;
  /** Every send goes through this queue, so two requests can never race for a nonce (per isolate on Workers). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly cfg: DemoTestnetConfig,
    readonly store: DemoRunStore,
    private readonly secrets: DemoSecretsSource,
  ) {}

  private load(): Promise<Loaded> {
    this.loaded ??= (async () => {
      const s = await this.secrets();
      const c97 = createChain97({ rpc: s.rpc, gasPrice: gasPriceFrom(this.cfg.gasPriceGwei), receiptTimeoutMs: this.cfg.receiptTimeoutMs });
      assertDemoChain(await c97.pub.getChainId());
      const d = getDeployment(DEMO_CHAIN_ID);
      if (!d) throw new DemoError(503, "not-deployed", "KeyEscrow is not deployed on BSC testnet in this build.");
      const accounts = Object.fromEntries(DEMO_ROLES.map((r) => [r, s.wallets[r].address])) as Record<DemoRole, Address>;
      assertAccounts(accounts);
      // The desk the leases name must be the dedicated demo wallet: not the factory default (the deployer), not the funder.
      const defaultArbiter = (await c97.pub.readContract({ address: d.escrowFactory, abi: escrowFactoryAbi, functionName: "defaultArbiter" })) as Address;
      assertDedicatedDesk(accounts.arbiter, { defaultArbiter, funder: s.funder?.address, landlord: accounts.landlord, tenant: accounts.tenant });
      return { c97, wallets: s.wallets, addresses: { factory: d.escrowFactory, token: d.mockUsdt, accounts }, funder: s.funder };
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
    const { busy, waitSec } = await this.store.peek(Date.now());
    return {
      enabled: true as const,
      chainId: DEMO_CHAIN_ID,
      accounts: l.addresses.accounts,
      busy,
      waitSec,
      gasPriceGwei: formatGwei(l.c97.gasPrice),
      maxGasPerRun: this.cfg.maxGasPerRun.toString(),
      maxCostTbnb: formatEther(this.cfg.maxGasPerRun * l.c97.gasPrice),
    };
  }

  /**
   * Starts a run for browser `owner`. If that browser already holds the lock (Start over) its run is replaced; if
   * `resumeLease` is given (its lock lapsed mid-story) the new run carries on with that demo lease.
   */
  async start(path: DemoTestnetPath, owner: string, resumeLease?: Address, ip?: string) {
    const l = await this.load();
    let lease: Address | undefined;
    if (resumeLease) {
      const [isLease, terms, status] = await Promise.all([
        l.c97.pub.readContract({ address: l.addresses.factory, abi: escrowFactoryAbi, functionName: "isLease", args: [resumeLease] }),
        l.c97.pub.readContract({ address: resumeLease, abi: rentalEscrowAbi, functionName: "terms" }).catch(() => undefined),
        l.c97.pub.readContract({ address: resumeLease, abi: rentalEscrowAbi, functionName: "status" }).catch(() => 99),
      ]);
      const t = terms as { landlord: Address; tenant: Address; arbiter: Address } | undefined;
      if (!t) throw new DemoError(400, "call-refused", "That is not a KeyEscrow rental.");
      vetResumeLease({ isLease: isLease as boolean, ...t, status: Number(status) }, l.addresses.accounts);
      lease = getAddress(resumeLease);
    }
    // Lock + rate limit + record, atomically in the store (a Durable Object on Workers).
    const { run, replaced } = await this.store.begin({ id: crypto.randomUUID(), owner, ip, path, now: Date.now(), lease });
    if (replaced) console.log(`[demo-testnet] run ${replaced.id.slice(0, 8)} replaced by the same browser: ${replaced.txs} txs, ${formatEther(replaced.cost)} tBNB`);
    try {
      const topUps = await this.serial(async () => {
        const out: TopUp[] = [];
        for (const role of DEMO_ROLES) {
          const t = await this.ensureGas(l, run, role);
          if (t) out.push(t);
        }
        return out;
      });
      await this.store.save(run);
      console.log(
        `[demo-testnet] run ${run.id.slice(0, 8)} ${path} started${lease ? ` (resumes lease ${lease})` : ""}${topUps.length ? `, topped up ${topUps.map((t) => t.role).join(", ")}` : ""}`,
      );
      return { runId: run.id, path, accounts: l.addresses.accounts, topUps };
    } catch (e) {
      await this.store.end(run.id);
      throw e;
    }
  }

  /** Tops `role` up from the funder when it runs low (within the cap), or refuses with a friendly message. */
  private async ensureGas(l: Loaded, run: RunState, role: DemoRole): Promise<TopUp | undefined> {
    const who = l.wallets[role].address;
    const [balance, funderBalance] = await Promise.all([
      l.c97.pub.getBalance({ address: who }),
      l.funder ? l.c97.pub.getBalance({ address: l.funder.address }) : Promise.resolve(BigInt(0)),
    ]);
    const plan = topUpPlan(balance, funderBalance, this.cfg.topUp);
    if (plan.action === "none") return undefined;
    if (plan.action === "refuse" || !l.funder) {
      console.warn(`[demo-testnet] top-up refused: ${l.funder ? `funder holds ${formatEther(funderBalance)} tBNB` : "no funder configured"}`);
      throw new DemoError(503, "low-funds", LOW_FUNDS_MESSAGE);
    }
    const hash = await l.c97.sendValue(await l.funder.account(), who, plan.amount);
    const r = await this.receipt(l, run, hash, `top-up:${role}`);
    run.gasUsed += r.gasUsed;
    run.cost += r.gasUsed * r.effectiveGasPrice;
    console.log(`[demo-testnet] topped up ${role} ${formatEther(plan.amount)} tBNB: ${txUrl(hash)}`);
    return { role, amount: formatEther(plan.amount), hash, url: txUrl(hash) };
  }

  private async receipt(l: Loaded, run: RunState, hash: Hash, key: string): Promise<TransactionReceipt> {
    try {
      const r = await l.c97.wait(hash);
      if (run.stalled?.hash === hash) run.stalled = undefined;
      return r;
    } catch (e) {
      if (!(e instanceof TxStalledError)) throw e;
      run.stalled = { key, hash };
      await this.store.save(run);
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
      const run = await this.store.touch(runId, Date.now());
      const key = `${req.role}:${req.address.toLowerCase()}:${req.data}`;
      let hash: Hash;
      let receipt: TransactionReceipt;
      if (run.stalled && run.stalled.key === key) {
        // Retry of a stalled call: wait for the transaction already sent instead of sending it twice.
        hash = run.stalled.hash;
        receipt = await this.receipt(l, run, hash, key);
      } else {
        if (run.stalled) await this.receipt(l, run, run.stalled.hash, run.stalled.key); // keep the nonce order
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
      if (!run.lastBlock || receipt.blockNumber > run.lastBlock) run.lastBlock = receipt.blockNumber;
      if (!run.lease && receipt.status === "success") {
        const factoryLogs = receipt.logs.filter((g) => g.address.toLowerCase() === l.addresses.factory.toLowerCase());
        const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: factoryLogs });
        if (created) run.lease = getAddress((created.args as { escrow: Address }).escrow);
      }
      await this.store.save(run);
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

  /**
   * eth_call for the stage, through the server's RPC (the one that mined the run's transactions) at the run's latest
   * receipt block, retried while a load-balanced backend catches up. Browsers far from the RPC (or behind a lagging
   * public endpoint) otherwise fail reads pinned to a block they have not seen yet. Read-only; this run's contracts only.
   */
  async read(runId: string, req: { address: string; data: Hex }): Promise<{ data: Hex }> {
    const l = await this.load();
    const run = await this.store.touch(runId, Date.now());
    const to = vetRead(req.address, run, l.addresses);
    for (let i = 0; ; i++) {
      try {
        const r = await l.c97.pub.call({ to, data: req.data, ...(run.lastBlock ? { blockNumber: run.lastBlock } : {}) });
        return { data: r.data ?? "0x" };
      } catch (e) {
        // A revert is an answer; anything else (unknown block, timeout) is retried for ~12 s.
        if ((e instanceof Error && /revert/i.test(e.message)) || i >= 12) throw e;
        await new Promise((ok) => setTimeout(ok, 1_000));
      }
    }
  }

  /**
   * PromptPay demo on-ramp (lib/server/onramp.ts vets the lease and the amount): MockUSDT.faucet to the renter, sent
   * by the demo tenant wallet. The faucet is public; the wallet only pays the gas.
   */
  async onRamp(lease: string) {
    const l = await this.load();
    const plan = await planOnRamp(l.c97.pub, DEMO_CHAIN_ID, l.addresses, lease);
    return this.serial(async () => {
      const call = { address: l.addresses.token, abi: mockUsdtAbi, functionName: "faucet", args: [plan.to, plan.amount] } as const;
      const { hash } = await l.c97.sendCall(l.wallets.tenant, call, { maxGas: BigInt(150_000) });
      const r = await l.c97.wait(hash);
      if (r.status !== "success") throw new DemoError(502, "chain-error", "The test mUSDT mint was reverted.");
      console.log(`[demo-testnet] PromptPay demo minted ${formatUnits(plan.amount, TOKEN.decimals)} ${TOKEN.symbol}: ${txUrl(hash)}`);
      return { hash, url: txUrl(hash), to: plan.to, amount: plan.amount.toString() };
    });
  }

  /** Heartbeat from the browser while a run plays; `error` = the step error the viewer sees (logged for diagnosis). */
  async ping(runId: string, error?: string) {
    if (error) console.warn(`[demo-testnet] run ${runId.slice(0, 8)} browser error: ${error}`);
    await this.store.touch(runId, Date.now());
    return { ok: true as const };
  }

  async end(runId: string, reason?: string) {
    const run = await this.store.end(runId);
    if (!run) return { ended: false as const };
    console.log(
      `[demo-testnet] run ${run.id.slice(0, 8)} ${run.path} ended${reason ? ` (${reason})` : ""}: ${run.txs} txs, ${run.gasUsed} gas, ${formatEther(run.cost)} tBNB`,
    );
    return { ended: true as const, txs: run.txs, gasUsed: run.gasUsed.toString(), costTbnb: formatEther(run.cost), lease: run.lease };
  }
}

const KEY = Symbol.for("keyescrow.demoTestnetRunner");
type Holder = { [KEY]?: { sig: string; runner: DemoTestnetRunner } };

/**
 * The process-wide runner, or undefined when the live testnet demo is off (DEMO_TESTNET_RUNNER unset, another chain,
 * no key source): the routes then answer 404. Kept on globalThis so dev-mode reloads keep the lock and rate limit.
 *
 * `deps` is the deploy seam: on Cloudflare Workers pass a Durable-Object-backed `store` (and `env` from the Worker's
 * bindings); keys then come from DEMO_TESTNET_KEYS through the same `loadDemoSecrets`.
 */
export function getDemoTestnetRunner(
  env: Env = process.env,
  deps: { store?: (cfg: DemoTestnetConfig) => DemoRunStore; secrets?: DemoSecretsSource } = {},
): DemoTestnetRunner | undefined {
  const cfg = demoTestnetConfig(env);
  if (!cfg) return undefined;
  const g = globalThis as Holder;
  const sig = JSON.stringify(cfg, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  if (g[KEY]?.sig !== sig) {
    const store = deps.store ? deps.store(cfg) : new MemoryRunStore(cfg);
    g[KEY] = { sig, runner: new DemoTestnetRunner(cfg, store, deps.secrets ?? (() => loadDemoSecrets(env, cfg))) };
  }
  return g[KEY].runner;
}
