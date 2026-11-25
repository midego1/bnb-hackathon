/**
 * The compare-and-set rule of SharedState, shared by MemoryState and the KeyEscrowState Durable Object
 * (web/cloudflare/state.ts) so both backends behave identically. Pure: no I/O, no clock of its own.
 */
export type Entry = { value: unknown; version: number; expiresAt?: number };

export const isLive = (e: Entry | undefined, now: number): e is Entry => !!e && (e.expiresAt === undefined || e.expiresAt > now);

/**
 * The entry to store when `expected` still matches, or null on a conflict. Versions keep counting through deletes and
 * expiry (a delete stores an already-expired tombstone), so a stale `expected` never matches a newer entry.
 */
export function casEntry(stored: Entry | undefined, expected: number, value: unknown, ttlMs: number | undefined, now: number): Entry | null {
  if ((isLive(stored, now) ? stored.version : 0) !== expected) return null;
  const version = (stored?.version ?? 0) + 1;
  if (value === null) return { value: null, version, expiresAt: now };
  return ttlMs !== undefined && ttlMs > 0 ? { value, version, expiresAt: now + ttlMs } : { value, version };
}
