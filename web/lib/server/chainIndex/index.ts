/**
 * Server-side chain index: every factory, rental escrow and Fleet Vault event of one deployment, scanned once from the
 * deployment's start block in bounded windows (default 5,000 blocks) with retry + backoff, then kept up to date
 * incrementally. Every page reads it through GET /api/chain/index, so a browser fires no eth_getLogs at all and a
 * public RPC (PublicNode on BSC testnet) sees a handful of log queries per refresh instead of dozens per page load.
 *
 * Cached in SharedState (a Map under Node, the KeyEscrowState Durable Object on Workers), so a refresh only scans the
 * blocks since the last one, and concurrent requests in one process share one refresh (singleflight). When the RPC
 * fails and a previous snapshot exists, that snapshot is served marked `stale` instead of an error.
 */
import { createPublicClient, getAbiItem, http, parseEventLogs, type Abi, type Address, type Hex, type Log, type PublicClient } from "viem";
import { rpcUrl, type Env } from "../../actions/context";
import type { SupportedChainId } from "../../actions/fields";
import type { ChainIndexResponse, ChainIndexSnapshot } from "../../chainIndex";
import { escrowFactoryAbi, fleetVaultAbi, getDeployment, mockUsdtAbi, rentalEscrowAbi } from "../../contracts";
import type { ChainEvent } from "../../rentals";
import { onCloudflare } from "../platform";
import { getSharedState, type SharedState } from "../state";
import { blockRanges, mapLimit, singleflight, splitOnRangeError, withRetry, type BlockRange, type RetryOptions } from "./scan";

export * from "./scan";

/** The RPC surface the indexer uses (a viem PublicClient satisfies it; tests pass a fake). */
export type IndexClient = Pick<PublicClient, "getBlock" | "getLogs" | "getTransactionReceipt">;

export type IndexDeployment = { escrowFactory: Address; mockUsdt: Address; fleetVault?: Address; fromBlock: bigint };

export type IndexerOptions = {
  chainId: number;
  client: IndexClient;
  deployment: IndexDeployment;
  /** Looked up per call: on Workers the Durable Object stub must not outlive its request. */
  state: () => SharedState;
  /** Max blocks per eth_getLogs (default 5,000; 0 = one query for the whole range, local anvil). */
  windowSize?: bigint;
  /** Log queries in flight at once (default 2). */
  concurrency?: number;
  /** Blocks re-scanned on every refresh to absorb short reorgs (default 12). */
  reorgDepth?: bigint;
  /** How old a snapshot may be and still be served without touching the RPC (ms). */
  ttlMs?: number;
  /** Rescan from the start block on every refresh (local anvil: snapshots/reverts rewrite history). */
  fullRescan?: boolean;
  /** Scan for reverted escrow transactions (local anvil only; far too heavy for a public RPC). */
  scanFailures?: boolean;
  /** Share one in-flight refresh between concurrent requests (default true; off on Workers, see chainIndexer). */
  singleflight?: boolean;
  retry?: RetryOptions;
  now?: () => number;
};

/** `error.at` = last failed refresh; `error.since` = first failure of the current streak. */
type Stored = { snapshot: ChainIndexSnapshot; error?: { error: string; since: number; at: number } };

export const stateKey = (chainId: number, factory: Address) => `chainindex:v1:${chainId}:${factory.toLowerCase()}`;
/** A caller's `minBlock` forces at most one refresh per this many ms. */
export const MIN_FORCED_GAP_MS = 1_000;
/** Most addresses one eth_getLogs may filter on (PublicNode refuses more than 10 with -32602). */
export const MAX_LOG_ADDRESSES = 10;
/** Snapshots stay in SharedState this long after their last refresh. */
const STORE_TTL_MS = 7 * 86_400_000;

const transferEvent = getAbiItem({ abi: mockUsdtAbi, name: "Transfer" });
const lower = (a: string) => a.toLowerCase();

function sortEvents(a: ChainEvent, b: ChainEvent) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Decoded events of `logs` that `abi` knows, minus `skip` names. Timestamps come from the log when the node sends them. */
function decode(logs: Log[], abi: Abi, skip: string[] = []): ChainEvent[] {
  const parsed = parseEventLogs({ abi, logs, strict: false }) as (Log & { eventName?: string; args?: unknown; blockTimestamp?: bigint | null })[];
  return parsed
    .filter((l) => l.eventName && !skip.includes(l.eventName) && l.blockNumber !== null && l.transactionHash !== null)
    .map((l) => ({
      address: l.address,
      name: l.eventName!,
      args: (l.args ?? {}) as Record<string, unknown>,
      txHash: l.transactionHash!,
      blockNumber: l.blockNumber!,
      logIndex: l.logIndex ?? 0,
      timestamp: typeof l.blockTimestamp === "bigint" ? l.blockTimestamp : BigInt(0),
    }));
}

export class ChainIndexer {
  private readonly o: Required<Omit<IndexerOptions, "retry">> & { retry: RetryOptions };
  private readonly flight = singleflight<ChainIndexResponse>();
  /** Reverted escrow transactions per block (local anvil), kept across refreshes: mined blocks do not change. */
  private readonly failureCache = new Map<bigint, { to: string; hash: Hex }[]>();
  /** How many RPC calls the last refresh made (tests, logs). */
  lastRefreshCalls = 0;

  constructor(opts: IndexerOptions) {
    this.o = {
      windowSize: BigInt(5_000),
      concurrency: 2,
      reorgDepth: BigInt(12),
      ttlMs: 4_000,
      fullRescan: false,
      scanFailures: false,
      singleflight: true,
      now: Date.now,
      retry: {},
      ...opts,
    };
  }

  get key() {
    return stateKey(this.o.chainId, this.o.deployment.escrowFactory);
  }

  /**
   * The index, refreshed first when it is older than ttlMs or does not reach `minBlock` yet (a transaction the caller
   * just sent). Throws only when the RPC fails and there is no earlier snapshot to fall back to.
   */
  async get(opts: { minBlock?: bigint; force?: boolean } = {}): Promise<ChainIndexResponse> {
    const stored = (await this.o.state().get<Stored>(this.key))?.value;
    const now = this.o.now();
    const reaches = (opts.minBlock ?? BigInt(0)) <= (stored?.snapshot.scannedTo ?? BigInt(-1));
    if (stored && !opts.force) {
      // `minBlock` comes from the caller: it may force a refresh at most once per MIN_FORCED_GAP_MS, so a bogus
      // far-future block cannot turn every request into RPC calls.
      if (!reaches && !stored.error && now - stored.snapshot.updatedAt < MIN_FORCED_GAP_MS) return stored.snapshot;
    }
    if (stored && !opts.force && reaches) {
      if (!stored.error && now - stored.snapshot.updatedAt < this.o.ttlMs) return stored.snapshot;
      // While the RPC keeps failing, try again at most every few seconds and serve the last good snapshot meanwhile.
      if (stored.error && now - stored.error.at < Math.max(this.o.ttlMs, 3_000)) return { ...stored.snapshot, stale: { error: stored.error.error, since: stored.error.since } };
    }
    return this.o.singleflight ? this.flight(this.key, () => this.refresh(stored)) : this.refresh(stored);
  }

  private async refresh(stored: Stored | undefined): Promise<ChainIndexResponse> {
    const prev = stored?.snapshot;
    try {
      const snapshot = await this.scan(prev);
      await this.save({ snapshot });
      return snapshot;
    } catch (err) {
      if (!prev) throw err;
      const now = this.o.now();
      const error = { error: shortError(err), since: stored?.error?.since ?? now, at: now };
      await this.save({ snapshot: prev, error }).catch(() => undefined);
      return { ...prev, stale: { error: error.error, since: error.since } };
    }
  }

  private async save(value: Stored) {
    const state = this.o.state();
    const cur = await state.get<Stored>(this.key);
    // Never overwrite a newer snapshot another request (or isolate) stored meanwhile.
    if (cur && cur.value.snapshot.scannedTo > value.snapshot.scannedTo) return;
    await state.set(this.key, cur?.version ?? 0, value, { ttlMs: STORE_TTL_MS });
  }

  /** One refresh: scan the blocks after `prev` (or everything), merge, and return the new snapshot. */
  async scan(prev: ChainIndexSnapshot | undefined): Promise<ChainIndexSnapshot> {
    const { client: c, deployment: d } = this.o;
    let calls = 0;
    const rpc = <T>(fn: () => Promise<T>) => {
      calls++;
      return withRetry(fn, this.o.retry);
    };
    const head = await rpc(() => c.getBlock({ blockTag: "latest" }));
    const latest = head.number!;
    const fromBlock = d.fromBlock;

    // Keep what we have unless the chain went backwards (local node restarted / reverted) or we rescan anyway.
    const reuse = prev && !this.o.fullRescan && prev.fromBlock === fromBlock && latest >= prev.scannedTo ? prev : undefined;
    const start = reuse ? max(fromBlock, reuse.scannedTo + BigInt(1) - this.o.reorgDepth) : fromBlock;
    const kept = reuse ? reuse.events.filter((e) => e.blockNumber < start) : [];
    const knownEscrows = new Set(kept.filter((e) => e.name === "LeaseCreated").map((e) => lower(String(e.args.escrow))));

    const size = this.o.windowSize > BigInt(0) ? this.o.windowSize : latest - start + BigInt(1);
    const windows = start <= latest ? blockRanges(start, latest, size > BigInt(0) ? size : BigInt(1)) : [];
    const logsIn = (range: BlockRange, q: (r: BlockRange) => Promise<Log[]>) => splitOnRangeError(range, (r) => rpc(() => q(r)));
    // Public RPCs cap the address list of one eth_getLogs (PublicNode: 10), so query in groups of MAX_LOG_ADDRESSES.
    const logsForAddresses = async (range: BlockRange, addrs: Address[]) => {
      const groups: Address[][] = [];
      for (let i = 0; i < addrs.length; i += MAX_LOG_ADDRESSES) groups.push(addrs.slice(i, i + MAX_LOG_ADDRESSES));
      const parts = await Promise.all(groups.map((g) => logsIn(range, (r) => c.getLogs({ address: g, ...r }) as Promise<Log[]>)));
      return parts.flat();
    };

    // Phase 1, per window: the factory, the vault and every escrow we already know (one query), and the token's
    // transfers into the vault (income from escrows, filtered below).
    const base = [d.escrowFactory, ...(d.fleetVault ? [d.fleetVault] : []), ...[...knownEscrows].map((a) => a as Address)];
    const phase1 = await mapLimit(windows, this.o.concurrency, async (w) => {
      const [own, inflow] = await Promise.all([
        logsForAddresses(w, base),
        d.fleetVault ? logsIn(w, (r) => c.getLogs({ address: d.mockUsdt, event: transferEvent, args: { to: d.fleetVault! }, ...r } as Parameters<IndexClient["getLogs"]>[0]) as Promise<Log[]>) : Promise.resolve([] as Log[]),
      ]);
      return { own, inflow };
    });
    const own = phase1.flatMap((p) => p.own);
    // Only the rental events of the factory (its admin events are not part of any rental's story).
    const factoryEvents = decode(own.filter((l) => lower(l.address) === lower(d.escrowFactory)), escrowFactoryAbi as Abi).filter(
      (e) => e.name === "LeaseCreated" || e.name === "PayeeSet",
    );
    const vaultEvents = d.fleetVault
      ? decode(own.filter((l) => lower(l.address) === lower(d.fleetVault!)), fleetVaultAbi as Abi, ["Transfer", "Approval"])
      : [];
    const escrowEvents = decode(own.filter((l) => knownEscrows.has(lower(l.address))), rentalEscrowAbi as Abi, ["Initialized"]);

    // Phase 2: escrows created in this range, from their creation window on.
    const created = factoryEvents.filter((e) => e.name === "LeaseCreated" && !knownEscrows.has(lower(String(e.args.escrow))));
    if (created.length) {
      const first = created.reduce((m, e) => (e.blockNumber < m ? e.blockNumber : m), created[0].blockNumber);
      const fresh = created.map((e) => e.args.escrow as Address);
      const later = windows.filter((w) => w.toBlock >= first).map((w) => ({ fromBlock: max(w.fromBlock, first), toBlock: w.toBlock }));
      const logs = await mapLimit(later, this.o.concurrency, (w) => logsForAddresses(w, fresh));
      escrowEvents.push(...decode(logs.flat(), rentalEscrowAbi as Abi, ["Initialized"]));
    }

    const escrows = new Set([...knownEscrows, ...created.map((e) => lower(String(e.args.escrow)))]);
    const inflow = decode(phase1.flatMap((p) => p.inflow), mockUsdtAbi as Abi).filter((e) => e.name === "Transfer" && escrows.has(lower(String(e.args.from))));

    const added = [...factoryEvents, ...vaultEvents, ...escrowEvents, ...inflow];
    // Nodes that do not put blockTimestamp on logs: one getBlock per distinct new block.
    const missing = [...new Set(added.filter((e) => e.timestamp === BigInt(0)).map((e) => e.blockNumber))];
    if (missing.length) {
      const times = new Map<bigint, bigint>();
      await mapLimit(missing, 4, async (n) => times.set(n, (await rpc(() => c.getBlock({ blockNumber: n }))).timestamp));
      for (const e of added) if (e.timestamp === BigInt(0)) e.timestamp = times.get(e.blockNumber) ?? BigInt(0);
    }

    const seen = new Set<string>();
    const events = [...kept, ...added].sort(sortEvents).filter((e) => {
      const k = `${e.txHash}:${e.logIndex}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    const escrowList = events.filter((e) => e.name === "LeaseCreated").map((e) => e.args.escrow as Address);

    let failed: Record<string, Hex[]> = {};
    if (this.o.scanFailures) failed = await this.scanFailures(fromBlock, latest, new Set(escrowList.map(lower)), () => calls++);

    this.lastRefreshCalls = calls;
    return {
      chainId: this.o.chainId,
      factory: d.escrowFactory,
      ...(d.fleetVault ? { vault: d.fleetVault } : {}),
      fromBlock,
      scannedTo: latest,
      latestBlock: latest,
      chainNow: head.timestamp,
      escrows: escrowList,
      events,
      failed,
      scannedFailures: this.o.scanFailures,
      updatedAt: this.o.now(),
    };
  }

  /** Local anvil only: reverted transactions sent to a rental escrow in the last 2,000 blocks (they emit no events). */
  private async scanFailures(from: bigint, to: bigint, leases: Set<string>, count: () => void) {
    const c = this.o.client;
    if ([...this.failureCache.keys()].some((n) => n > to)) this.failureCache.clear();
    const start = to - from > BigInt(2_000) ? to - BigInt(2_000) : from;
    const todo: bigint[] = [];
    for (let n = start; n <= to; n += BigInt(1)) if (!this.failureCache.has(n)) todo.push(n);
    await mapLimit(todo, 20, async (n) => {
      count();
      const block = await c.getBlock({ blockNumber: n, includeTransactions: true });
      const reverted: { to: string; hash: Hex }[] = [];
      for (const tx of block.transactions) {
        if (typeof tx === "string" || !tx.to) continue;
        count();
        const receipt = await c.getTransactionReceipt({ hash: tx.hash });
        if (receipt.status === "reverted") reverted.push({ to: lower(tx.to), hash: tx.hash });
      }
      this.failureCache.set(n, reverted);
    });
    const failed: Record<string, Hex[]> = {};
    for (const [n, list] of this.failureCache) {
      if (n < start || n > to) continue;
      for (const f of list) if (leases.has(f.to)) (failed[f.to] ??= []).push(f.hash);
    }
    return failed;
  }
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);

function shortError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return String(e?.shortMessage ?? e?.message ?? err).split("\n")[0].slice(0, 200);
}

// ---------------------------------------------------------------------------------------------------------
// The app's indexers: one per chain + factory, configured from env.
// ---------------------------------------------------------------------------------------------------------

const INDEXERS = Symbol.for("keyescrow.chainIndexers");

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** The indexer for `chainId` (undefined when KeyEscrow is not deployed there). Env: CHAIN_INDEX_* (see .env.example). */
export function chainIndexer(chainId: SupportedChainId, env: Env = process.env): ChainIndexer | undefined {
  const d = getDeployment(chainId);
  if (!d) return undefined;
  const local = chainId === 31337;
  const url = rpcUrl(chainId, env);
  const g = globalThis as Record<symbol, Map<string, ChainIndexer> | undefined>;
  const all = (g[INDEXERS] ??= new Map());
  const id = `${chainId}:${lower(d.escrowFactory)}:${url}`;
  let ix = all.get(id);
  if (!ix) {
    const client = createPublicClient({ transport: http(url, { timeout: 15_000, retryCount: 0 }) }) as PublicClient;
    ix = new ChainIndexer({
      chainId,
      client,
      deployment: { escrowFactory: d.escrowFactory, mockUsdt: d.mockUsdt, fleetVault: d.fleetVault, fromBlock: d.fromBlock },
      state: getSharedState,
      windowSize: BigInt(local ? 0 : Math.max(1, num(env.CHAIN_INDEX_BLOCK_RANGE, 5_000))),
      concurrency: Math.max(1, num(env.CHAIN_INDEX_CONCURRENCY, 2)),
      ttlMs: num(env.CHAIN_INDEX_TTL_MS, local ? 0 : 4_000),
      fullRescan: local,
      scanFailures: local,
      // A promise settled by another request's I/O must not be awaited on Workers; each request refreshes on its own.
      singleflight: !onCloudflare(),
    });
    all.set(id, ix);
  }
  return ix;
}
