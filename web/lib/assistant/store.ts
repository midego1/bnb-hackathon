/**
 * The only state Ask AI keeps between requests, behind one small interface so it can live in memory (next start, dev,
 * tests) or in a Workers KV / Durable Object later. Values are plain JSON (bigints as strings); every key has a TTL.
 */
export interface AssistantStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Add `by` to a counter and return the new value; the TTL is set when the counter is created. */
  incr(key: string, by: number, ttlMs: number): Promise<number>;
}

type Entry = { value: unknown; expires: number };

/** In-memory store with lazy expiry. `now` is injectable for tests. */
export function memoryStore(now: () => number = Date.now): AssistantStore & { size(): number } {
  const map = new Map<string, Entry>();
  const live = (key: string) => {
    const e = map.get(key);
    if (!e) return undefined;
    if (e.expires <= now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  };
  const sweep = () => {
    if (map.size < 5000) return;
    const t = now();
    for (const [k, e] of map) if (e.expires <= t) map.delete(k);
  };
  return {
    async get<T>(key: string) {
      return live(key)?.value as T | undefined;
    },
    async set(key, value, ttlMs) {
      sweep();
      map.set(key, { value: structuredClone(value), expires: now() + ttlMs });
    },
    async delete(key) {
      map.delete(key);
    },
    async incr(key, by, ttlMs) {
      const e = live(key);
      const value = ((e?.value as number | undefined) ?? 0) + by;
      map.set(key, { value, expires: e?.expires ?? now() + ttlMs });
      return value;
    },
    size: () => map.size,
  };
}

/**
 * An AssistantStore over a versioned compare-and-set store, i.e. lib/server/state's SharedState (a Map under Node,
 * the KeyEscrowState Durable Object on Workers). Structural type, so this file stays free of server imports.
 */
export type CasState = {
  get<T>(key: string): Promise<{ value: T; version: number } | null>;
  set<T>(key: string, expected: number, value: T | null, opts?: { ttlMs?: number }): Promise<number | null>;
};

export function casStore(state: CasState, prefix = "assistant:"): AssistantStore {
  const k = (key: string) => prefix + key;
  async function write<T>(key: string, fn: (cur: T | undefined) => T | null, ttlMs?: number): Promise<T | null> {
    for (let i = 0; i < 8; i++) {
      const cur = await state.get<T>(k(key));
      const next = fn(cur?.value);
      if ((await state.set(k(key), cur?.version ?? 0, next, ttlMs ? { ttlMs } : undefined)) !== null) return next;
    }
    throw new Error(`assistant store: key ${key} is too contended`);
  }
  return {
    async get<T>(key: string) {
      return (await state.get<T>(k(key)))?.value ?? undefined;
    },
    async set(key, value, ttlMs) {
      await write(key, () => value, ttlMs);
    },
    async delete(key) {
      await write(key, () => null);
    },
    async incr(key, by, ttlMs) {
      // A counter keeps the expiry it was created with: the window, not the last hit, decides.
      for (let i = 0; i < 8; i++) {
        const cur = await state.get<{ n: number; until: number }>(k(key));
        const now = Date.now();
        const live = cur && cur.value.until > now ? cur.value : undefined;
        const next = { n: (live?.n ?? 0) + by, until: live?.until ?? now + ttlMs };
        if ((await state.set(k(key), cur?.version ?? 0, next, { ttlMs: Math.max(1, next.until - now) })) !== null) return next.n;
      }
      throw new Error(`assistant store: counter ${key} is too contended`);
    },
  };
}
