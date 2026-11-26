import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, HttpRequestError, pad, type Abi, type AbiEvent, type Address, type Hex } from "viem";
import { decodeJson, encodeJson, eventsOfLease, latestLease, type ChainIndexSnapshot } from "@/lib/chainIndex";
import { EX, withSample } from "@/lib/actions/definitions";
import { escrowFactoryAbi, fleetVaultAbi, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import {
  backoffMs,
  blockRanges,
  ChainIndexer,
  isRangeError,
  isRetryable,
  mapLimit,
  singleflight,
  splitOnRangeError,
  withRetry,
  type IndexClient,
} from "@/lib/server/chainIndex";
import { MemoryState } from "@/lib/server/state";

const b = (n: number) => BigInt(n);

// ---------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------

describe("blockRanges", () => {
  it("cuts an inclusive range into windows of at most `size` blocks", () => {
    expect(blockRanges(b(100), b(12_099), b(5_000))).toEqual([
      { fromBlock: b(100), toBlock: b(5_099) },
      { fromBlock: b(5_100), toBlock: b(10_099) },
      { fromBlock: b(10_100), toBlock: b(12_099) },
    ]);
  });
  it("handles a single block, an exact multiple and an empty range", () => {
    expect(blockRanges(b(7), b(7), b(5_000))).toEqual([{ fromBlock: b(7), toBlock: b(7) }]);
    expect(blockRanges(b(0), b(9_999), b(5_000))).toHaveLength(2);
    expect(blockRanges(b(10), b(9), b(5_000))).toEqual([]);
    expect(() => blockRanges(b(0), b(1), b(0))).toThrow();
  });
  it("never produces a window larger than the size or a gap", () => {
    const w = blockRanges(b(144_802_840), b(144_900_001), b(5_000));
    for (let i = 0; i < w.length; i++) {
      expect(w[i].toBlock - w[i].fromBlock + b(1)).toBeLessThanOrEqual(b(5_000));
      if (i > 0) expect(w[i].fromBlock).toBe(w[i - 1].toBlock + b(1));
    }
    expect(w.at(-1)!.toBlock).toBe(b(144_900_001));
  });
});

describe("error classification", () => {
  it("treats rate limits, gateway refusals, 5xx and timeouts as retryable", () => {
    expect(isRetryable(new HttpRequestError({ url: "https://rpc", status: 429 }))).toBe(true);
    expect(isRetryable(new HttpRequestError({ url: "https://rpc", status: 403 }))).toBe(true);
    expect(isRetryable(new HttpRequestError({ url: "https://rpc", status: 502 }))).toBe(true);
    expect(isRetryable(new Error("The request took too long to respond. timed out"))).toBe(true);
    expect(isRetryable(new Error("rate limit exceeded"))).toBe(true);
    expect(isRetryable(new HttpRequestError({ url: "https://rpc", status: 400 }))).toBe(false);
    expect(isRetryable(new Error("execution reverted"))).toBe(false);
  });
  it("recognises a refused block range (and does not mistake a rate limit for one)", () => {
    expect(isRangeError(new Error("exceed maximum block range: 5000"))).toBe(true);
    expect(isRangeError(new Error("eth_getLogs is limited to a 10,000 range"))).toBe(false);
    expect(isRangeError(new Error("block range is too wide"))).toBe(true);
    expect(isRangeError(new Error("query returned more than 10000 results"))).toBe(true);
    expect(isRangeError(new Error("limit exceeded"))).toBe(true);
    expect(isRangeError(new Error("rate limit exceeded"))).toBe(false);
    expect(isRetryable(new Error("exceed maximum block range: 5000"))).toBe(false);
  });
});

describe("withRetry / backoff", () => {
  it("doubles the backoff per retry, capped, plus at most 50 % jitter", () => {
    expect([1, 2, 3, 4, 5, 6].map((r) => backoffMs(r, { baseMs: 300, maxMs: 4_000, random: () => 0 }))).toEqual([300, 600, 1_200, 2_400, 4_000, 4_000]);
    expect(backoffMs(1, { baseMs: 300, random: () => 1 })).toBe(450);
  });
  it("retries a 429 with growing waits, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 3) throw new HttpRequestError({ url: "https://rpc", status: 429 });
        return "ok";
      },
      { sleep: async (ms) => void waits.push(ms), random: () => 0 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(waits).toEqual([300, 600]);
  });
  it("gives up after `attempts` and rethrows the last error", async () => {
    let calls = 0;
    const err = new HttpRequestError({ url: "https://rpc", status: 403 });
    await expect(withRetry(async () => ((calls++, Promise.reject(err))), { attempts: 3, sleep: async () => {} })).rejects.toBe(err);
    expect(calls).toBe(3);
  });
  it("does not retry what cannot succeed later", async () => {
    let calls = 0;
    await expect(withRetry(async () => ((calls++, Promise.reject(new Error("execution reverted")))), { sleep: async () => {} })).rejects.toThrow("reverted");
    expect(calls).toBe(1);
  });
});

describe("splitOnRangeError", () => {
  it("halves a refused range until the node accepts it, keeping every result in order", async () => {
    const asked: [bigint, bigint][] = [];
    const out = await splitOnRangeError({ fromBlock: b(0), toBlock: b(3_999) }, async (r) => {
      asked.push([r.fromBlock, r.toBlock]);
      if (r.toBlock - r.fromBlock + b(1) > b(1_000)) throw new Error("exceed maximum block range: 1000");
      return [r.fromBlock];
    });
    expect(out).toEqual([b(0), b(1_000), b(2_000), b(3_000)]);
    expect(asked.filter(([f, t]) => t - f + b(1) <= b(1_000))).toHaveLength(4);
  });
  it("rethrows other errors and gives up below the minimum size", async () => {
    await expect(splitOnRangeError({ fromBlock: b(0), toBlock: b(10) }, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(splitOnRangeError({ fromBlock: b(0), toBlock: b(50) }, async () => Promise.reject(new Error("block range too large")))).rejects.toThrow("range");
  });
});

describe("mapLimit / singleflight", () => {
  it("keeps at most `limit` tasks in flight and the input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (x) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, x));
      inFlight--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
  it("shares one in-flight run per key", async () => {
    const once = singleflight<number>();
    let runs = 0;
    const fn = () => new Promise<number>((r) => setTimeout(() => r(++runs), 5));
    expect(await Promise.all([once("k", fn), once("k", fn), once("other", fn)])).toEqual([1, 1, 2]);
    expect(await once("k", fn)).toBe(3);
  });
});

describe("bigint JSON codec", () => {
  it("round-trips bigints, nested args and plain objects", () => {
    const v = { a: b(1), list: [{ n: b(2) ** b(70) }], s: "0xabc", o: { $n: "x", y: 1 } };
    expect(decodeJson(encodeJson(v))).toEqual(v);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The indexer against a fake RPC with a 5,000-block log range limit
// ---------------------------------------------------------------------------------------------------------

const FACTORY = "0x00000000000000000000000000000000000000f1" as Address;
const VAULT = "0x00000000000000000000000000000000000000b1" as Address;
const TOKEN = "0x00000000000000000000000000000000000000c1" as Address;
const LEASE_A = getAddress("0x00000000000000000000000000000000000000a1");
const LEASE_B = getAddress("0x00000000000000000000000000000000000000a2");
const OWNER = "0x0000000000000000000000000000000000000001" as Address;
const RENTER = "0x0000000000000000000000000000000000000002" as Address;
const DESK = "0x0000000000000000000000000000000000000003" as Address;
const INVESTOR = "0x0000000000000000000000000000000000000004" as Address;
const FROM = b(1_000);

type RawLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  transactionIndex: number;
  blockHash: Hex;
  removed: boolean;
  blockTimestamp?: bigint;
};

let txn = 0;
function log(address: Address, abi: Abi, eventName: string, args: Record<string, unknown>, block: number, withTimestamp = true): RawLog {
  const ev = getAbiItem({ abi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi: [ev], eventName, args: args as never }) as Hex[];
  const plain = ev.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(plain, plain.map((i) => args[i.name!]) as never);
  txn++;
  return {
    address,
    topics,
    data,
    blockNumber: b(block),
    logIndex: 0,
    transactionHash: `0x${txn.toString(16).padStart(64, "0")}`,
    transactionIndex: 0,
    blockHash: `0x${block.toString(16).padStart(64, "0")}`,
    removed: false,
    ...(withTimestamp ? { blockTimestamp: b(1_700_000_000 + block) } : {}),
  };
}

const created = (escrow: Address, block: number) =>
  log(FACTORY, escrowFactoryAbi as Abi, "LeaseCreated", {
    escrow, landlord: OWNER, tenant: RENTER, arbiter: DESK, rentAmount: b(100), depositAmount: b(200),
    termPeriods: 1, rentPeriod: 2_592_000, responseWindow: 604_800, arbiterWindow: 1_209_600, leaseHash: pad("0x11"),
  }, block);
const funded = (escrow: Address, block: number) =>
  log(escrow, rentalEscrowAbi as Abi, "Funded", { tenant: RENTER, deposit: b(200), firstRent: b(100), startTime: b(1_700_000_000 + block) }, block);
const transfer = (from: Address, to: Address, block: number) => log(TOKEN, mockUsdtAbi as Abi, "Transfer", { from, to, value: b(90) }, block);

class FakeRpc {
  logs: RawLog[] = [];
  head = 20_000;
  maxRange = b(5_000);
  calls: { method: string; from?: bigint; to?: bigint; address?: unknown }[] = [];
  /** Fail the next N calls with this error. */
  failNext: { n: number; err: () => Error } = { n: 0, err: () => new Error() };

  private gate(method: string, extra: Partial<FakeRpc["calls"][number]> = {}) {
    this.calls.push({ method, ...extra });
    if (this.failNext.n > 0) {
      this.failNext.n--;
      throw this.failNext.err();
    }
  }

  client(): IndexClient {
    return {
      getBlock: (async (args?: { blockNumber?: bigint }) => {
        this.gate("getBlock");
        const n = args?.blockNumber ?? b(this.head);
        return { number: n, timestamp: b(1_700_000_000) + n, hash: pad("0x01"), transactions: [] };
      }) as never,
      getLogs: (async (args: { address: Address | Address[]; fromBlock: bigint; toBlock: bigint; event?: AbiEvent; args?: { to?: Address } }) => {
        this.gate("getLogs", { from: args.fromBlock, to: args.toBlock, address: args.address });
        if (args.toBlock - args.fromBlock + b(1) > this.maxRange) throw new Error(`exceed maximum block range: ${this.maxRange}`);
        const addrs = (Array.isArray(args.address) ? args.address : [args.address]).map((a) => a.toLowerCase());
        return this.logs.filter((l) => {
          if (!addrs.includes(l.address.toLowerCase()) || l.blockNumber < args.fromBlock || l.blockNumber > args.toBlock) return false;
          if (args.event) {
            const [topic0] = encodeEventTopics({ abi: [args.event], eventName: args.event.name } as never) as Hex[];
            if (l.topics[0] !== topic0) return false;
            if (args.args?.to && l.topics[2]?.toLowerCase() !== pad(args.args.to).toLowerCase()) return false;
          }
          return true;
        });
      }) as never,
      getTransactionReceipt: (async () => {
        throw new Error("not used");
      }) as never,
    };
  }
}

function setup(opts: { ttlMs?: number; now?: () => number } = {}) {
  const rpc = new FakeRpc();
  rpc.logs.push(
    created(LEASE_A, 1_500),
    log(FACTORY, escrowFactoryAbi as Abi, "PayeeSet", { escrow: LEASE_A, payee: VAULT }, 1_500),
    log(FACTORY, escrowFactoryAbi as Abi, "FeeUpdated", { feeBps: 1000, feeRecipient: OWNER }, 1_600),
    funded(LEASE_A, 7_000), // a later window than its creation
    log(LEASE_A, rentalEscrowAbi as Abi, "RentReleased", { caller: OWNER, periods: 1, toLandlord: b(90), fee: b(10) }, 12_000),
    transfer(LEASE_A, VAULT, 12_000), // income into the vault
    transfer(INVESTOR, VAULT, 12_500), // principal, not income
    log(VAULT, fleetVaultAbi as Abi, "Deposited", { investor: INVESTOR, amount: b(500) }, 12_500),
    log(VAULT, fleetVaultAbi as Abi, "Transfer", { from: "0x0000000000000000000000000000000000000000", to: INVESTOR, value: b(500) }, 12_500), // share mint
  );
  const state = new MemoryState();
  let clock = 1_000_000;
  const now = opts.now ?? (() => clock);
  const ix = new ChainIndexer({
    chainId: 97,
    client: rpc.client(),
    deployment: { escrowFactory: FACTORY, mockUsdt: TOKEN, fleetVault: VAULT, fromBlock: FROM },
    state: () => state,
    windowSize: b(5_000),
    ttlMs: opts.ttlMs ?? 4_000,
    retry: { sleep: async () => {}, random: () => 0 },
    now,
  });
  return { rpc, ix, state, tick: (ms: number) => (clock += ms) };
}

const names = (s: ChainIndexSnapshot) => s.events.map((e) => e.name);

describe("ChainIndexer", () => {
  it("cold scan: bounded windows only, finds escrow events in later windows, vault income but not principal", async () => {
    const { rpc, ix } = setup();
    const s = await ix.get();
    const logCalls = rpc.calls.filter((c) => c.method === "getLogs");
    for (const c of logCalls) expect(c.to! - c.from! + b(1)).toBeLessThanOrEqual(b(5_000));
    // 19,001 blocks = 4 windows: (factory+vault) + inflow per window, then the new escrow from its creation window on.
    expect(logCalls).toHaveLength(4 * 2 + 4);
    expect(s.scannedTo).toBe(b(20_000));
    expect(s.escrows).toEqual([LEASE_A]);
    expect(names(s)).toEqual(["LeaseCreated", "PayeeSet", "Funded", "RentReleased", "Transfer", "Deposited"]);
    const income = s.events.find((e) => e.name === "Transfer")!;
    expect(income.args.from).toBe(LEASE_A);
    expect(s.events.every((e) => e.timestamp === b(1_700_000_000) + e.blockNumber)).toBe(true);
    expect(eventsOfLease(s.events, LEASE_A).map((e) => e.name)).toEqual(["LeaseCreated", "PayeeSet", "Funded", "RentReleased"]);
  });

  it("serves the cached snapshot within the TTL without touching the RPC", async () => {
    const { rpc, ix } = setup();
    const first = await ix.get();
    const before = rpc.calls.length;
    const again = await ix.get();
    expect(rpc.calls.length).toBe(before);
    expect(again).toEqual(first);
  });

  it("after the TTL scans only the new blocks (plus a short reorg tail), appending new escrows and events", async () => {
    const { rpc, ix, tick } = setup();
    await ix.get();
    rpc.calls = [];
    rpc.head = 20_100;
    rpc.logs.push(created(LEASE_B, 20_050), funded(LEASE_B, 20_060), log(LEASE_A, rentalEscrowAbi as Abi, "DisputeRaised", { by: RENTER }, 20_090));
    tick(5_000);
    const s = await ix.get();
    const logCalls = rpc.calls.filter((c) => c.method === "getLogs");
    expect(logCalls.every((c) => c.from! >= b(20_000 - 12))).toBe(true);
    expect(logCalls).toHaveLength(3); // own + inflow + the new escrow
    expect(s.escrows).toEqual([LEASE_A, LEASE_B]);
    expect(names(s).filter((n) => n === "Funded")).toHaveLength(2);
    expect(names(s)).toContain("DisputeRaised");
    // No duplicates from the re-scanned tail.
    expect(new Set(s.events.map((e) => `${e.txHash}:${e.logIndex}`)).size).toBe(s.events.length);
  });

  it("refreshes before the TTL when the caller's transaction is in a newer block (minBlock)", async () => {
    const { rpc, ix, tick } = setup();
    await ix.get();
    rpc.head = 20_003;
    rpc.logs.push(log(LEASE_A, rentalEscrowAbi as Abi, "DisputeRaised", { by: RENTER }, 20_002));
    expect(names(await ix.get())).not.toContain("DisputeRaised");
    tick(1_000);
    expect(names(await ix.get({ minBlock: b(20_002) }))).toContain("DisputeRaised");
  });

  it("does not let a far-future minBlock force more than one refresh per second", async () => {
    const { rpc, ix, tick } = setup();
    await ix.get();
    const calls = rpc.calls.length;
    await ix.get({ minBlock: b(999_999_999) });
    await ix.get({ minBlock: b(999_999_999) });
    expect(rpc.calls.length).toBe(calls);
    tick(1_000);
    await ix.get({ minBlock: b(999_999_999) });
    expect(rpc.calls.length).toBeGreaterThan(calls);
  });

  it("retries rate-limited calls with backoff and still returns the full index", async () => {
    const { rpc, ix } = setup();
    rpc.failNext = { n: 2, err: () => new HttpRequestError({ url: "https://rpc", status: 429 }) };
    const s = await ix.get();
    expect(s.escrows).toEqual([LEASE_A]);
    expect(names(s)).toContain("RentReleased");
  });

  it("serves the last good snapshot marked stale when the RPC keeps failing, and throws only without one", async () => {
    const { rpc, ix, tick } = setup();
    rpc.failNext = { n: 100, err: () => new HttpRequestError({ url: "https://rpc", status: 403 }) };
    await expect(ix.get()).rejects.toThrow();
    rpc.failNext.n = 0;
    const good = await ix.get();
    tick(5_000);
    rpc.failNext = { n: 100, err: () => new HttpRequestError({ url: "https://rpc", status: 429 }) };
    const stale = await ix.get();
    expect(stale.stale?.error).toMatch(/429|HTTP|failed/i);
    expect(stale.events).toEqual(good.events);
    // While failing it does not hammer the RPC on every request.
    const calls = rpc.calls.length;
    await ix.get();
    expect(rpc.calls.length).toBe(calls);
    // Recovered: fresh again, no stale flag.
    tick(5_000);
    rpc.failNext.n = 0;
    expect((await ix.get()).stale).toBeUndefined();
  });

  it("splits a window the node still refuses", async () => {
    const { rpc, ix } = setup();
    rpc.maxRange = b(2_000);
    const s = await ix.get();
    expect(names(s)).toEqual(["LeaseCreated", "PayeeSet", "Funded", "RentReleased", "Transfer", "Deposited"]);
  });

  it("rescans from the start when the chain went backwards (local node restarted)", async () => {
    const { rpc, ix, tick } = setup();
    await ix.get();
    rpc.head = 5_000;
    rpc.logs = rpc.logs.filter((l) => l.blockNumber <= b(5_000));
    tick(5_000);
    const s = await ix.get();
    expect(s.scannedTo).toBe(b(5_000));
    expect(names(s)).toEqual(["LeaseCreated", "PayeeSet"]);
  });

  it("fetches block times only when the node leaves them off the logs", async () => {
    const { rpc, ix } = setup();
    rpc.logs.push(log(LEASE_A, rentalEscrowAbi as Abi, "DisputeRaised", { by: RENTER }, 15_000, false));
    const s = await ix.get();
    expect(rpc.calls.filter((c) => c.method === "getBlock")).toHaveLength(2); // head + block 15,000
    expect(s.events.find((e) => e.name === "DisputeRaised")!.timestamp).toBe(b(1_700_015_000));
  });

  it("shares one refresh between concurrent requests", async () => {
    const { rpc, ix } = setup();
    await Promise.all([ix.get(), ix.get(), ix.get()]);
    expect(rpc.calls.filter((c) => c.method === "getBlock")).toHaveLength(1);
  });
});

describe("GET /api/chain/index", () => {
  it("refuses unsupported chains and malformed block numbers before touching any RPC", async () => {
    const { GET } = await import("@/app/api/chain/index/route");
    expect((await GET(new Request("http://x/api/chain/index?chainId=1"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/chain/index"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/chain/index?chainId=97&minBlock=-1"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/chain/index?chainId=97&minBlock=0x10"))).status).toBe(400);
  });
});

describe("demo samples from the index (no hard-coded rentals off anvil)", () => {
  const created = (escrow: string, landlord: string) =>
    ({ address: "0x0000000000000000000000000000000000000f00", name: "LeaseCreated", args: { escrow, landlord, tenant: "0xb", arbiter: "0xc" } }) as never;

  it("latestLease is the newest LeaseCreated, undefined without rentals", () => {
    expect(latestLease({ events: [] })).toBeUndefined();
    expect(latestLease({ events: [created("0x1", "0xa"), created("0x2", "0xd")] })).toEqual({ lease: "0x2", owner: "0xd", renter: "0xb", arbiter: "0xc" });
  });

  it("withSample swaps the anvil example values and keeps the rest", () => {
    const sample = { lease: "0x2", owner: "0xd", renter: "0xb", arbiter: "0xc" };
    expect(withSample({ lease: EX.lease, from: EX.owner, toRenter: "800" }, sample)).toEqual({ lease: "0x2", from: "0xd", toRenter: "800" });
    expect(withSample({ party: EX.renter, role: "renter" }, sample)).toEqual({ party: "0xb", role: "renter" });
    expect(withSample({ lease: EX.lease }, undefined)).toEqual({ lease: EX.lease });
  });
});
