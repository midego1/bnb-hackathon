import type { Address } from "viem";
import { RateLimiter, RunLock, type DemoTestnetConfig, type DemoTestnetPath, type RunState } from "./guards";

/**
 * Where the one-run lock, the rate limit and the live run's state live. The runner only talks to this interface, so the
 * in-memory store below (one Node process: `next start`) can be swapped for a Cloudflare Durable Object (one instance,
 * e.g. idFromName("demo-testnet"), its methods running one at a time) without touching the runner.
 *
 * Contract for an implementation:
 *  - `begin` is atomic: check the lock (409 "busy" with a "free in ~N s" estimate unless the same owner holds it, which
 *    takes it over), check the rate limit (429; a takeover skips the 60 s gap, not the hourly cap), take the lock and
 *    record the start. guards.ts RunLock/RateLimiter hold these rules and can run inside the Durable Object as is.
 *  - `touch` returns the caller's run with lastSeen refreshed (410 "run-gone" when the lock lapsed or was taken over).
 *  - `save` persists the runner's changes to a run it got from `begin`/`touch` (gas, lease, last block, stalled tx).
 *    RunState holds bigints: a Durable Object's storage (structured clone) keeps them; for KV, JSON-encode them.
 *  - `end` frees the lock if `runId` still holds it and returns the final run state.
 */
export interface DemoRunStore {
  begin(req: { id: string; owner: string; path: DemoTestnetPath; now: number; lease?: Address }): Promise<{ run: RunState; replaced?: RunState }>;
  touch(runId: string, now: number): Promise<RunState>;
  save(run: RunState): Promise<void>;
  end(runId: string): Promise<RunState | undefined>;
  /** For the status route: is a run live, and how long until a new one may start. */
  peek(now: number): Promise<{ busy: boolean; waitSec: number }>;
}

/** The store for a single long-lived Node server (pnpm testnet:web). Runs share one object, so `save` has nothing to do. */
export class MemoryRunStore implements DemoRunStore {
  readonly lock: RunLock;
  readonly rate: RateLimiter;
  constructor(cfg: DemoTestnetConfig) {
    this.lock = new RunLock(cfg);
    this.rate = new RateLimiter(cfg);
  }

  async begin(req: { id: string; owner: string; path: DemoTestnetPath; now: number; lease?: Address }) {
    const held = this.lock.heldBy(req.owner, req.now);
    if (held === "other") this.lock.acquire("probe", req.path, req.now, req.owner); // throws the friendly 409
    this.rate.check(req.now, { takeover: held === "self" });
    const out = this.lock.acquire(req.id, req.path, req.now, req.owner);
    out.run.lease = req.lease;
    this.rate.record(req.now);
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
