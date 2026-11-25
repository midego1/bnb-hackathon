import { afterEach, describe, expect, it, vi } from "vitest";
import { demoTestnetConfig, DemoError } from "@/lib/server/demoTestnet/guards";
import { MemoryRunStore, SharedRunStore, type DemoRunStore } from "@/lib/server/demoTestnet/store";
import { DisabledEvidenceStore, evidenceStoreFromEnv, EvidenceUploadsDisabledError, R2EvidenceStore, storeEvidence, type R2BucketLike } from "@/lib/server/evidence";
import { cloudflareEnv, onCloudflare } from "@/lib/server/platform";
import { PriceService } from "@/lib/server/price";
import {
  acquireLock,
  cacheGet,
  cachePut,
  DurableObjectState,
  getSharedState,
  hitRateLimit,
  MemoryState,
  peekRateLimit,
  readLock,
  releaseLock,
  renewLock,
  update,
  type KeyEscrowStateNamespace,
  type SharedState,
} from "@/lib/server/state";
import { casEntry, isLive, type Entry } from "@/lib/server/state/entry";

const CONTEXT = Symbol.for("__cloudflare-context__");
const g = globalThis as unknown as Record<symbol, unknown>;
afterEach(() => {
  delete g[CONTEXT];
});

/** A stand-in for the KeyEscrowState Durable Object: same entry rules (entry.ts), values structured-cloned over "RPC". */
function fakeNamespace(now: () => number = Date.now) {
  const storage = new Map<string, Entry>();
  const stub = {
    async get(key: string) {
      const e = storage.get(key);
      return isLive(e, now()) ? structuredClone(e) : null;
    },
    async set(key: string, expected: number, value: unknown, ttlMs?: number) {
      const next = casEntry(storage.get(key), expected, structuredClone(value), ttlMs, now());
      if (!next) return null;
      storage.set(key, next);
      return next.version;
    },
  };
  const ns: KeyEscrowStateNamespace = { idFromName: (name) => `id:${name}`, get: () => stub };
  return { ns, storage };
}

const backends: [string, (now: () => number) => SharedState][] = [
  ["memory", (now) => new MemoryState(now)],
  ["durable object (fake)", (now) => new DurableObjectState(fakeNamespace(now).ns)],
];

describe.each(backends)("SharedState on %s", (_name, make) => {
  it("compare-and-set: absent is version 0, a stale version loses, delete and expiry count as absent", async () => {
    let t = 1_000;
    const s = make(() => t);
    expect(await s.get("k")).toBeNull();
    expect(await s.set("k", 1, "x")).toBeNull(); // not there yet
    const v1 = await s.set("k", 0, { n: BigInt(7) });
    expect(v1).toBe(1);
    expect((await s.get<{ n: bigint }>("k"))?.value.n).toBe(BigInt(7)); // bigint survives (structured clone)
    expect(await s.set("k", 0, "again")).toBeNull(); // someone else wrote first
    expect(await s.set("k", 1, null)).toBe(2); // delete
    expect(await s.get("k")).toBeNull();
    expect(await s.set("k", 1, "stale")).toBeNull(); // version 1 is gone for good
    expect(await s.set("k", 0, "ttl", { ttlMs: 500 })).toBe(3);
    t += 499;
    expect((await s.get("k"))?.value).toBe("ttl");
    t += 1;
    expect(await s.get("k")).toBeNull();
    expect(await s.set("k", 3, "late")).toBeNull();
    expect(await s.set("k", 0, "fresh")).toBe(4);
  });

  it("locks: one holder, takeover by the same owner, heartbeat, idle expiry, release by token", async () => {
    let t = 0;
    const s = make(() => t);
    const a = await acquireLock(s, "demo", { owner: "A", ttlMs: 45_000, now: t });
    expect(a.ok).toBe(true);
    const b = await acquireLock(s, "demo", { owner: "B", ttlMs: 45_000, now: t });
    expect(b).toMatchObject({ ok: false, heldBy: { owner: "A" } });
    const again = await acquireLock(s, "demo", { owner: "A", ttlMs: 45_000, now: t, data: { gas: 1 } });
    if (!again.ok || !a.ok) throw new Error("takeover failed");
    expect(again.replaced?.token).toBe(a.lock.token);
    expect(await renewLock(s, "demo", a.lock.token, { ttlMs: 45_000 })).toBeNull(); // old token lost it
    t = 40_000;
    expect((await renewLock<{ gas: number }>(s, "demo", again.lock.token, { ttlMs: 45_000, now: t, data: (d) => ({ gas: (d?.gas ?? 0) + 1 }) }))?.data).toEqual({ gas: 2 });
    t = 80_000; // 40 s after the heartbeat: still held
    expect((await readLock(s, "demo", { now: t }))?.owner).toBe("A");
    t = 86_000; // 46 s without a heartbeat: free
    expect(await readLock(s, "demo", { now: t })).toBeNull();
    const c = await acquireLock(s, "demo", { owner: "B", ttlMs: 45_000, now: t });
    if (!c.ok) throw new Error("expected B to get the lapsed lock");
    expect(await releaseLock(s, "demo", "wrong")).toBeNull();
    expect((await releaseLock(s, "demo", c.lock.token))?.owner).toBe("B");
    expect(await readLock(s, "demo", { now: t })).toBeNull();
  });

  it("locks: maxHoldMs caps a lock however often it is renewed", async () => {
    let t = 0;
    const s = make(() => t);
    const a = await acquireLock(s, "l", { owner: "A", ttlMs: 10_000, maxHoldMs: 25_000, now: t });
    if (!a.ok) throw new Error("acquire failed");
    for (t = 5_000; t <= 25_000; t += 5_000) expect(await renewLock(s, "l", a.lock.token, { ttlMs: 10_000, maxHoldMs: 25_000, now: t })).not.toBeNull();
    t = 26_000;
    expect(await renewLock(s, "l", a.lock.token, { ttlMs: 10_000, maxHoldMs: 25_000, now: t })).toBeNull();
    expect((await acquireLock(s, "l", { owner: "B", ttlMs: 10_000, maxHoldMs: 25_000, now: t })).ok).toBe(true);
  });

  it("rate limits: a minimum gap and a sliding window", async () => {
    let t = 0;
    const s = make(() => t);
    const opts = () => ({ limit: 3, windowMs: 3_600_000, minGapMs: 60_000, now: t });
    expect(await hitRateLimit(s, "runs", opts())).toEqual({ ok: true, remaining: 2 });
    t = 30_000;
    expect(await hitRateLimit(s, "runs", opts())).toEqual({ ok: false, reason: "gap", retryAfterSec: 30 });
    t = 60_000;
    expect((await hitRateLimit(s, "runs", opts())).ok).toBe(true);
    t = 120_000;
    expect(await hitRateLimit(s, "runs", opts())).toEqual({ ok: true, remaining: 0 });
    t = 200_000;
    expect(await peekRateLimit(s, "runs", opts())).toEqual({ ok: false, reason: "window", retryAfterSec: 3400 });
    t = 3_600_000;
    expect((await hitRateLimit(s, "runs", opts())).ok).toBe(true);
  });

  it("caches with a TTL", async () => {
    let t = 0;
    const s = make(() => t);
    await cachePut(s, "q", { a: 1 }, 1_000);
    expect(await cacheGet(s, "q")).toEqual({ a: 1 });
    t = 1_000;
    expect(await cacheGet(s, "q")).toBeUndefined();
  });
});

describe("update (read-modify-write)", () => {
  it("retries a lost compare-and-set and gives up after the attempts", async () => {
    const s = new MemoryState();
    let interfere = 2;
    const racy: SharedState = {
      kind: "memory",
      get: (k) => s.get(k),
      async set(k, expected, value, opts) {
        if (interfere-- > 0) await s.set(k, (await s.get(k))?.version ?? 0, "other writer");
        return s.set(k, expected, value, opts);
      },
    };
    expect(await update<string, string>(racy, "k", (cur) => ({ value: `${cur ?? ""}+`, result: "done" }))).toBe("done");
    expect((await s.get("k"))?.value).toBe("other writer+");
    interfere = 99;
    await expect(update(racy, "k", () => ({ value: "x", result: 1 }), { attempts: 3 })).rejects.toThrow(/contended/);
  });
});

describe("platform detection", () => {
  it("is Node unless an OpenNext request context is set, and then uses the KEYESCROW_STATE binding", () => {
    expect(onCloudflare()).toBe(false);
    expect(cloudflareEnv()).toBeUndefined();
    expect(getSharedState().kind).toBe("memory");
    g[CONTEXT] = { env: { KEYESCROW_STATE: fakeNamespace().ns, NEXT_PUBLIC_CHAIN_ID: "97" } };
    expect(onCloudflare()).toBe(true);
    expect(getSharedState().kind).toBe("durable-object");
  });
});

describe("evidence on Cloudflare Workers", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

  it("keeps the Node behaviour (local disk / Greenfield) off Workers", () => {
    expect(evidenceStoreFromEnv({}).name).toBe("local");
  });

  it("refuses uploads with a clear 503 when no R2 bucket is bound, and finds nothing", async () => {
    const store = evidenceStoreFromEnv({ GREENFIELD_RPC_URL: "x" }, { cloudflare: true });
    expect(store).toBeInstanceOf(DisabledEvidenceStore);
    const err = await storeEvidence(store, PNG, "a.png").catch((e) => e);
    expect(err).toBeInstanceOf(EvidenceUploadsDisabledError);
    expect(err).toMatchObject({ status: 503, message: "evidence uploads are disabled on this deployment" });
    expect(await store.get(`0x${"a".repeat(64)}`)).toBeNull();
  });

  it("stores content-addressed objects in the EVIDENCE R2 bucket", async () => {
    const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
    const bucket: R2BucketLike = {
      head: async (k) => objects.get(k) ?? null,
      get: async (k) => {
        const o = objects.get(k);
        return o ? { arrayBuffer: async () => o.bytes.slice().buffer } : null;
      },
      put: vi.fn(async (k: string, v: Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => {
        objects.set(k, { bytes: v, contentType: o?.httpMetadata?.contentType });
        return {};
      }),
    };
    const store = evidenceStoreFromEnv({}, { cloudflare: true, r2: bucket });
    expect(store).toBeInstanceOf(R2EvidenceStore);
    const rec = await storeEvidence(store, PNG, "a.png");
    await storeEvidence(store, PNG, "again.png");
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect([...objects.keys()]).toEqual([`evidence/${rec.hash.slice(2)}`]);
    expect(objects.get(`evidence/${rec.hash.slice(2)}`)?.contentType).toBe("image/png");
    expect((await store.get(rec.hash))?.contentType).toBe("image/png");
  });
});

describe("PriceService shared cache (one quote across isolates)", () => {
  it("serves a live quote another isolate fetched, and never shares mock answers", async () => {
    const state = new MemoryState();
    const env = { CMC_API_KEY: "k" };
    const fetchOk = vi.fn(async (url: string | URL | Request) => {
      const convert = new URL(String(url)).searchParams.get("convert")!;
      const q = (price: number) => ({ quote: { [convert]: { price, last_updated: "2026-11-24T23:59:00.000Z" } } });
      return Response.json({ status: { error_code: 0 }, data: { USDT: [q(1)], BNB: [q(600)] } });
    }) as unknown as typeof fetch;
    const a = new PriceService({ env, fetch: fetchOk, shared: () => state, dedupe: false });
    const b = new PriceService({ env, fetch: fetchOk, shared: () => state, dedupe: false });
    expect((await a.get()).source).toBe("cmc");
    expect(fetchOk).toHaveBeenCalledTimes(2); // USD + THB
    const fromB = await b.get();
    expect(fromB).toMatchObject({ source: "cmc", cached: true });
    expect(fetchOk).toHaveBeenCalledTimes(2);

    const mockOnly = new MemoryState();
    await new PriceService({ env: {}, shared: () => mockOnly }).get();
    expect(await cacheGet(mockOnly, "price:quote")).toBeUndefined();
  });
});

describe("demo-testnet run store: SharedRunStore behaves like MemoryRunStore", () => {
  const cfg = demoTestnetConfig({ DEMO_TESTNET_RUNNER: "1", NEXT_PUBLIC_CHAIN_ID: "97", DEMO_TESTNET_KEYS: "{}" })!;
  const errOf = (fn: () => Promise<unknown>) =>
    fn().then(
      () => undefined,
      (e: unknown) => e as DemoError,
    );
  const stores: [string, () => DemoRunStore][] = [
    ["memory", () => new MemoryRunStore(cfg)],
    ["shared state (Durable Object)", () => {
      const { ns } = fakeNamespace();
      return new SharedRunStore(cfg, () => new DurableObjectState(ns));
    }],
  ];

  it.each(stores)("%s: one run, busy for others, takeover by the same browser, rate limit after end", async (_n, make) => {
    const store = make();
    const { run } = await store.begin({ id: "a", owner: "browser-A", path: "happy", now: 0 });
    expect(await store.peek(1_000)).toEqual({ busy: true, waitSec: 0 });
    expect(await errOf(() => store.begin({ id: "b", owner: "browser-B", path: "happy", now: 1_000 }))).toMatchObject({ status: 409, code: "busy" });
    const t = await store.begin({ id: "a2", owner: "browser-A", path: "dispute", now: 2_000 });
    expect(t.replaced?.id).toBe(run.id);
    expect(await errOf(() => store.touch("a", 3_000))).toMatchObject({ status: 410 });
    expect((await store.end("a2"))?.id).toBe("a2");
    expect(await store.peek(4_000)).toEqual({ busy: false, waitSec: 58 });
    expect(await errOf(() => store.begin({ id: "c", owner: "browser-B", path: "happy", now: 4_000 }))).toMatchObject({ status: 429 });
  });

  it("SharedRunStore persists the runner's changes (bigint gas) and frees an idle run", async () => {
    const { ns, storage } = fakeNamespace();
    const store = new SharedRunStore(cfg, () => new DurableObjectState(ns));
    const now = Date.now();
    const { run } = await store.begin({ id: "r1", owner: "browser-A", path: "happy", now });
    run.gasUsed += BigInt(21_000);
    run.txs += 1;
    run.lease = "0x00000000000000000000000000000000000000aa";
    await store.save(run);
    const seen = await store.touch("r1", now + 5_000);
    expect(seen).toMatchObject({ gasUsed: BigInt(21_000), txs: 1, lease: "0x00000000000000000000000000000000000000aa" });
    expect(storage.has(SharedRunStore.KEY)).toBe(true);
    // A stale copy (older lastSeen) does not roll the heartbeat back.
    await store.save({ ...run, lastSeen: now });
    expect((await store.touch("r1", now + 6_000)).lastSeen).toBe(now + 6_000);
    // Idle past cfg.idleMs: the run is gone.
    expect(await errOf(() => store.touch("r1", now + 6_000 + cfg.idleMs + 1))).toMatchObject({ status: 410 });
    expect((await store.peek(now + 6_000 + cfg.idleMs + 1)).busy).toBe(false);
  });
});
