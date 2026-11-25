import { casEntry, isLive, type Entry } from "./entry";
import type { SharedState, Versioned } from "./types";

/** In-process SharedState for Node (`next dev`, `next start`, tests). Same rules as the Durable Object (entry.ts). */
export class MemoryState implements SharedState {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  async get<T>(key: string): Promise<Versioned<T> | null> {
    const e = this.entries.get(key);
    if (!isLive(e, this.now())) return null;
    // Cloned like a Durable Object's storage would, so callers can never mutate the stored value in place.
    return { ...e, value: structuredClone(e.value) as T };
  }

  async set<T>(key: string, expected: number, value: T | null, opts: { ttlMs?: number } = {}): Promise<number | null> {
    const next = casEntry(this.entries.get(key), expected, value === null ? null : structuredClone(value), opts.ttlMs, this.now());
    if (!next) return null;
    this.entries.set(key, next);
    return next.version;
  }
}
