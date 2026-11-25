import { DurableObject } from "cloudflare:workers";
import { casEntry, isLive, type Entry } from "../lib/server/state/entry";

/**
 * KeyEscrowState: the Worker-safe home of everything that used to live in process memory across requests (locks,
 * rate limits, caches, the live testnet demo's run). One SQLite-backed instance ("global") serves the whole app.
 * lib/server/state/durable.ts is the client; lib/server/state/index.ts builds locks, rate limits and caches on this
 * versioned compare-and-set, and lib/server/demoTestnet/store.ts SharedRunStore keeps the demo runner's lock here.
 *
 * Atomicity: a Durable Object handles one event at a time and its input gate holds other events while it awaits its
 * own storage, so the read and the write in `set` cannot interleave with another request.
 */
export class KeyEscrowState extends DurableObject {
  async get(key: string): Promise<Entry | null> {
    const e = await this.ctx.storage.get<Entry>(key);
    return isLive(e, Date.now()) ? e : null;
  }

  async set(key: string, expected: number, value: unknown, ttlMs?: number): Promise<number | null> {
    const next = casEntry(await this.ctx.storage.get<Entry>(key), expected, value, ttlMs, Date.now());
    if (!next) return null;
    await this.ctx.storage.put(key, next);
    if (next.expiresAt !== undefined) await this.scheduleSweep(next.expiresAt + SWEEP_GRACE_MS);
    return next.version;
  }

  /** Deletes entries (and tombstones) that expired more than SWEEP_GRACE_MS ago, then re-arms for the next one. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const dead: string[] = [];
    let next: number | undefined;
    for (const [k, e] of await this.ctx.storage.list<Entry>()) {
      if (e.expiresAt === undefined) continue;
      const due = e.expiresAt + SWEEP_GRACE_MS;
      if (due <= now) dead.push(k);
      else next = Math.min(next ?? Infinity, due);
    }
    for (let i = 0; i < dead.length; i += 128) await this.ctx.storage.delete(dead.slice(i, i + 128));
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  private async scheduleSweep(at: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }
}

/**
 * Expired entries and tombstones stay this long before the sweep removes them (which restarts their version count),
 * so a writer holding a version read just before a delete still gets a conflict rather than a reused version.
 */
const SWEEP_GRACE_MS = 10 * 60_000;
