import { cloudflareBinding, onCloudflare } from "../platform";
import { DurableObjectState, type KeyEscrowStateNamespace } from "./durable";
import { MemoryState } from "./memory";
import { StateContentionError, type SharedState } from "./types";

export * from "./types";
export { MemoryState } from "./memory";
export { DurableObjectState, type KeyEscrowStateNamespace, type KeyEscrowStateStub } from "./durable";

/** Name of the Durable Object namespace binding in web/wrangler.jsonc. */
export const STATE_BINDING = "KEYESCROW_STATE";

const MEMORY = Symbol.for("keyescrow.sharedState.memory");
let warned = false;

/**
 * The shared state for this request: the KeyEscrowState Durable Object on Cloudflare Workers, a process-wide Map
 * under Node. Call it per request (do not keep the result across requests on Workers).
 */
export function getSharedState(): SharedState {
  const ns = cloudflareBinding<KeyEscrowStateNamespace>(STATE_BINDING);
  if (ns) return new DurableObjectState(ns);
  if (onCloudflare() && !warned) {
    warned = true;
    console.warn(`[state] no ${STATE_BINDING} binding: locks, rate limits and caches are per isolate only`);
  }
  // On globalThis so Next's dev server (module reloads) keeps one store per process.
  const g = globalThis as Record<symbol, SharedState | undefined>;
  return (g[MEMORY] ??= new MemoryState());
}

// ---------------------------------------------------------------------------------------------------------
// Read-modify-write
// ---------------------------------------------------------------------------------------------------------

/** What an `update` callback decides: the new value (null deletes, undefined leaves the key alone) and a result. */
export type Update<T, R> = { value?: T | null; ttlMs?: number; result: R };

/**
 * Atomic read-modify-write of one key: `fn` sees the current value (undefined when absent) and returns the next one.
 * Retries on a lost compare-and-set, so `fn` must be pure (it may run more than once).
 */
export async function update<T, R>(
  state: SharedState,
  key: string,
  fn: (current: T | undefined) => Update<T, R>,
  opts: { attempts?: number } = {},
): Promise<R> {
  const attempts = opts.attempts ?? 8;
  for (let i = 0; i < attempts; i++) {
    const cur = await state.get<T>(key);
    const next = fn(cur?.value);
    if (next.value === undefined) return next.result;
    const written = await state.set(key, cur?.version ?? 0, next.value, { ttlMs: next.ttlMs });
    if (written !== null) return next.result;
  }
  throw new StateContentionError(key);
}

// ---------------------------------------------------------------------------------------------------------
// Locks: one holder at a time, kept alive by heartbeats, freed on release or when the holder goes quiet
// ---------------------------------------------------------------------------------------------------------

export interface LockState<D = unknown> {
  /** Who holds it (e.g. a browser id): the same owner may take its own lock over. */
  owner: string;
  /** Changes on every acquire; renew/release must present it. */
  token: string;
  acquiredAt: number;
  renewedAt: number;
  /** Caller data that lives with the lock (e.g. a demo run's gas used). */
  data?: D;
}

export type AcquireResult<D> = { ok: true; lock: LockState<D>; replaced?: LockState<D> } | { ok: false; heldBy: LockState<D> };

/**
 * Take lock `name` for `owner`. Free (or expired after `ttlMs` without a heartbeat) -> taken. Held by the same owner
 * -> taken over when `takeover` (default true). Held by someone else -> `{ok: false, heldBy}`.
 * `maxHoldMs` caps the total hold time however often it is renewed.
 */
export async function acquireLock<D>(
  state: SharedState,
  name: string,
  opts: { owner: string; ttlMs: number; maxHoldMs?: number; takeover?: boolean; data?: D; now?: number },
): Promise<AcquireResult<D>> {
  const now = opts.now ?? Date.now();
  return update<LockState<D>, AcquireResult<D>>(state, lockKey(name), (cur) => {
    const live = cur && !lockExpired(cur, now, opts.maxHoldMs) ? cur : undefined;
    if (live && (live.owner !== opts.owner || opts.takeover === false)) return { result: { ok: false, heldBy: live } };
    const lock: LockState<D> = { owner: opts.owner, token: crypto.randomUUID(), acquiredAt: now, renewedAt: now, data: opts.data };
    return { value: lock, ttlMs: opts.ttlMs, result: { ok: true, lock, ...(live ? { replaced: live } : {}) } };
  });
}

/** Heartbeat: extend the lock by `ttlMs` (and optionally change its data). Null when the token no longer holds it. */
export async function renewLock<D>(
  state: SharedState,
  name: string,
  token: string,
  opts: { ttlMs: number; maxHoldMs?: number; data?: (d: D | undefined) => D; now?: number },
): Promise<LockState<D> | null> {
  const now = opts.now ?? Date.now();
  return update<LockState<D>, LockState<D> | null>(state, lockKey(name), (cur) => {
    if (!cur || cur.token !== token || lockExpired(cur, now, opts.maxHoldMs)) return { result: null };
    const next: LockState<D> = { ...cur, renewedAt: now, ...(opts.data ? { data: opts.data(cur.data) } : {}) };
    return { value: next, ttlMs: opts.ttlMs, result: next };
  });
}

/** The current holder, or null when the lock is free. */
export async function readLock<D>(state: SharedState, name: string, opts: { maxHoldMs?: number; now?: number } = {}) {
  const cur = await state.get<LockState<D>>(lockKey(name));
  return cur && !lockExpired(cur.value, opts.now ?? Date.now(), opts.maxHoldMs) ? cur.value : null;
}

/** Free the lock if `token` still holds it; returns the released state. */
export async function releaseLock<D>(state: SharedState, name: string, token: string): Promise<LockState<D> | null> {
  return update<LockState<D>, LockState<D> | null>(state, lockKey(name), (cur) =>
    cur && cur.token === token ? { value: null, result: cur } : { result: null },
  );
}

const lockKey = (name: string) => `lock:${name}`;
const lockExpired = (l: LockState<unknown>, now: number, maxHoldMs?: number) => maxHoldMs !== undefined && now - l.acquiredAt > maxHoldMs;

// ---------------------------------------------------------------------------------------------------------
// Rate limits: at most `limit` hits per sliding `windowMs`, and at least `minGapMs` between hits
// ---------------------------------------------------------------------------------------------------------

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  minGapMs?: number;
  now?: number;
}
export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSec: number; reason: "gap" | "window" };

/** How long until the next hit is allowed, without recording one. */
export async function peekRateLimit(state: SharedState, key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const cur = await state.get<number[]>(rateKey(key));
  return rateVerdict(cur?.value ?? [], opts, opts.now ?? Date.now());
}

/** Check and record one hit atomically. */
export async function hitRateLimit(state: SharedState, key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  return update<number[], RateLimitResult>(state, rateKey(key), (cur) => {
    const verdict = rateVerdict(cur ?? [], opts, now);
    if (!verdict.ok) return { result: verdict };
    const hits = [...(cur ?? []).filter((t) => now - t < opts.windowMs), now];
    return { value: hits, ttlMs: opts.windowMs, result: { ok: true, remaining: Math.max(0, opts.limit - hits.length) } };
  });
}

function rateVerdict(all: number[], opts: RateLimitOptions, now: number): RateLimitResult {
  const hits = all.filter((t) => now - t < opts.windowMs);
  const last = hits.at(-1);
  if (opts.minGapMs && last !== undefined && now - last < opts.minGapMs) {
    return { ok: false, reason: "gap", retryAfterSec: Math.ceil((last + opts.minGapMs - now) / 1000) };
  }
  if (hits.length >= opts.limit) return { ok: false, reason: "window", retryAfterSec: Math.ceil((hits[0] + opts.windowMs - now) / 1000) };
  return { ok: true, remaining: opts.limit - hits.length };
}

const rateKey = (key: string) => `rate:${key}`;

// ---------------------------------------------------------------------------------------------------------
// Small caches
// ---------------------------------------------------------------------------------------------------------

export async function cacheGet<T>(state: SharedState, key: string): Promise<T | undefined> {
  return (await state.get<T>(`cache:${key}`))?.value;
}

/** Best effort: a concurrent writer simply wins. */
export async function cachePut<T>(state: SharedState, key: string, value: T, ttlMs: number): Promise<void> {
  const k = `cache:${key}`;
  const cur = await state.get<T>(k);
  await state.set(k, cur?.version ?? 0, value, { ttlMs });
}
