/**
 * Shared server state that survives across requests and isolates: locks, rate limits and small caches.
 *
 * Under Node (`next dev` / `next start`, one process) it is a Map in memory. On Cloudflare Workers every request may
 * land in a different isolate, so process memory is not shared: there it is the KeyEscrowState Durable Object
 * (cloudflare/state.ts, binding KEYESCROW_STATE), which is strongly consistent and single-threaded per key space.
 *
 * The primitive is a versioned compare-and-set, so any read-modify-write (a lock with heartbeat and takeover, a
 * sliding-window rate limit, a cache entry) is built on top of it once (lib/server/state/index.ts) and behaves the
 * same on both backends. Values are structured-cloned, so bigint and nested objects survive (no JSON round trip).
 */
export interface Versioned<T> {
  value: T;
  /** Increases on every write. 0 never appears here: it means "absent" in `set`. */
  version: number;
  /** Epoch ms after which the entry counts as absent; undefined = no expiry. */
  expiresAt?: number;
}

export interface SharedState {
  readonly kind: "memory" | "durable-object";
  /** The live entry for `key`, or null when absent or expired. */
  get<T>(key: string): Promise<Versioned<T> | null>;
  /**
   * Write `value` only if `key` is still at version `expected` (0 = absent or expired). `null` deletes.
   * Returns the new version, or null when another writer got there first (re-read and retry).
   */
  set<T>(key: string, expected: number, value: T | null, opts?: { ttlMs?: number }): Promise<number | null>;
}

/** Thrown when a read-modify-write keeps losing the compare-and-set race. */
export class StateContentionError extends Error {
  constructor(key: string) {
    super(`shared state key "${key}" is too contended; try again`);
    this.name = "StateContentionError";
  }
}
