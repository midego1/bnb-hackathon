import type { Address } from "viem";
import { update, type SharedState } from "../state";
import { DemoError, RateLimiter, RunLock, type DemoTestnetConfig, type DemoTestnetPath, type RunState } from "./guards";

/**
 * Where the one-run lock, the rate limit and the live run's state live. The runner only talks to this interface, so the
 * in-memory store below (one Node process: `next start`) can be swapped for a Cloudflare Durable Object (one instance,
 * e.g. idFromName("demo-testnet"), its methods running one at a time) without touching the runner.
 *
 * Contract for an implementation:
 *  - `begin` is atomic: check the lock (409 "busy" with a "free in ~N s" estimate unless the same owner holds it, which
 *    takes it over), check the rate limit (429; a takeover skips the 60 s gap, not the hourly cap), take the lock and
 *    record the start. guards.ts RunLock/RateLimiter hold these rules and can run inside the Durable Object as is.
 *    Starts are also capped per caller IP (takeovers and resumes count), so one visitor cannot use up the hourly cap.
 *  - `touch` returns the caller's run with lastSeen refreshed (410 "run-gone" when the lock lapsed or was taken over).
 *  - `save` persists the runner's changes to a run it got from `begin`/`touch` (gas, lease, last block, stalled tx).
 *    RunState holds bigints: a Durable Object's storage (structured clone) keeps them; for KV, JSON-encode them.
 *  - `end` frees the lock if `runId` still holds it and returns the final run state.
 */
export interface DemoRunStore {
  begin(req: BeginRequest): Promise<{ run: RunState; replaced?: RunState }>;
  touch(runId: string, now: number): Promise<RunState>;
  save(run: RunState): Promise<void>;
  end(runId: string): Promise<RunState | undefined>;
  /** For the status route: is a run live, and how long until a new one may start. */
  peek(now: number): Promise<{ busy: boolean; waitSec: number }>;
}

type BeginRequest = { id: string; owner: string; ip?: string; path: DemoTestnetPath; now: number; lease?: Address };

const HOUR = 3_600_000;
/** Starts per caller IP per hour (Start over and resumes count too). */
export const RUNS_PER_IP_PER_HOUR = 4;

/**
 * The begin rules, shared by both stores: lock check (409), rate limit (429, takeover skips the gap), per-IP cap
 * (429), take, record. `ipStarts`: this IP's earlier starts; returns them with this one added.
 */
function beginRun(lock: RunLock, rate: RateLimiter, req: BeginRequest, ipStarts: number[] = []) {
  const held = lock.heldBy(req.owner, req.now);
  if (held === "other") lock.acquire("probe", req.path, req.now, req.owner); // throws the friendly 409
  rate.check(req.now, { takeover: held === "self" });
  const mine = ipStarts.filter((t) => req.now - t < HOUR);
  if (mine.length >= RUNS_PER_IP_PER_HOUR) {
    const wait = Math.ceil((mine[0] + HOUR - req.now) / 1000);
    throw new DemoError(429, "rate-limited", `You started the live testnet demo ${RUNS_PER_IP_PER_HOUR} times this hour. It is free for you again in about ${Math.ceil(wait / 60)} min; the local demo has no limit.`, wait);
  }
  const out = lock.acquire(req.id, req.path, req.now, req.owner);
  out.run.lease = req.lease;
  rate.record(req.now);
  return { ...out, ipStarts: [...mine, req.now] };
}

/** The store for a single long-lived Node server (pnpm testnet:web). Runs share one object, so `save` has nothing to do. */
export class MemoryRunStore implements DemoRunStore {
  readonly lock: RunLock;
  readonly rate: RateLimiter;
  private readonly ips = new Map<string, number[]>();
  constructor(cfg: DemoTestnetConfig) {
    this.lock = new RunLock(cfg);
    this.rate = new RateLimiter(cfg);
  }

  async begin(req: BeginRequest) {
    const ip = req.ip ?? "local";
    const { ipStarts, ...out } = beginRun(this.lock, this.rate, req, this.ips.get(ip));
    for (const [k, v] of this.ips) if (req.now - v[v.length - 1] >= HOUR) this.ips.delete(k);
    this.ips.set(ip, ipStarts);
    return out;
  }

  async touch(runId: string, now: number) {
    return this.lock.get(runId, now);
  }

  async save() {}

  async end(runId: string) {
    return this.lock.release(runId);
  }

  async peek(now: number) {
    const busy = !!this.lock.current(now);
    return { busy, waitSec: busy ? 0 : this.rate.waitSec(now) };
  }
}

type Persisted = { run?: RunState; starts: number[]; ips?: Record<string, number[]> };

/**
 * The store for hosts where every request may land in a different process (Cloudflare Workers): the lock, the rate
 * limit and the live run are one record in lib/server/state's SharedState, i.e. the KeyEscrowState Durable Object
 * (web/cloudflare/state.ts) on Workers and a Map under Node (tests). Every call is one atomic read-modify-write that
 * runs the same RunLock/RateLimiter rules as MemoryRunStore on the restored record.
 *
 * `state` is called per operation: on Workers a Durable Object stub must not outlive its request.
 */
export class SharedRunStore implements DemoRunStore {
  static readonly KEY = "demo-testnet:runs";
  /** The record outlives the hourly rate-limit window, then expires on its own. */
  private static readonly TTL_MS = 2 * 3_600_000;

  constructor(
    private readonly cfg: DemoTestnetConfig,
    private readonly state: () => SharedState,
  ) {}

  /**
   * Restore lock + limiter, apply `fn`, persist both. A DemoError thrown by `fn` writes nothing. With `now` (the
   * caller's clock, as in begin/touch) a lapsed run and starts older than an hour are pruned before persisting.
   */
  private tx<R>(now: number | undefined, fn: (lock: RunLock, rate: RateLimiter, ips: Record<string, number[]>) => R): Promise<R> {
    return update<Persisted, R>(this.state(), SharedRunStore.KEY, (cur) => {
      const lock = new RunLock(this.cfg, cur?.run);
      const rate = new RateLimiter(this.cfg, cur?.starts ?? []);
      let ips = { ...cur?.ips };
      const result = fn(lock, rate, ips);
      if (now !== undefined) lock.current(now);
      const starts = now !== undefined ? rate.snapshot(now) : (cur?.starts ?? []).concat();
      if (now !== undefined) ips = Object.fromEntries(Object.entries(ips).filter(([, v]) => now - v[v.length - 1] < HOUR));
      return { value: { run: lock.snapshot(), starts, ips }, ttlMs: SharedRunStore.TTL_MS, result };
    });
  }

  begin(req: BeginRequest) {
    return this.tx(req.now, (lock, rate, ips) => {
      const ip = req.ip ?? "local";
      const { ipStarts, ...out } = beginRun(lock, rate, req, ips[ip]);
      ips[ip] = ipStarts;
      return out;
    });
  }

  touch(runId: string, now: number) {
    return this.tx(now, (lock) => lock.get(runId, now));
  }

  /** Persist the runner's changes to the live run. A run that lapsed or was taken over meanwhile is left alone. */
  async save(run: RunState): Promise<void> {
    await this.tx(undefined, (lock) => {
      const cur = lock.snapshot();
      if (cur?.id !== run.id) return;
      // A ping may have refreshed lastSeen while this request worked on its copy: keep the later one.
      Object.assign(cur, run, { lastSeen: Math.max(cur.lastSeen, run.lastSeen) });
    });
  }

  end(runId: string) {
    return this.tx(undefined, (lock) => lock.release(runId));
  }

  async peek(now: number) {
    const cur = (await this.state().get<Persisted>(SharedRunStore.KEY))?.value;
    const lock = new RunLock(this.cfg, cur?.run);
    const rate = new RateLimiter(this.cfg, cur?.starts ?? []);
    const busy = !!lock.current(now);
    return { busy, waitSec: busy ? 0 : rate.waitSec(now) };
  }
}
