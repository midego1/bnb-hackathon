import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChainReadError, encodeJson, fetchChainIndex, noteMinedBlock, type ChainIndexResponse } from "@/lib/chainIndex";

// Browser fetch of GET /api/chain/index (lib/chainIndex.ts): the minBlock catch-up after our own transaction.
// minBlocks is per tab and per chain, so each test uses its own chain id.

const b = (n: number) => BigInt(n);
const snapshot = (scannedTo: number): ChainIndexResponse => ({
  chainId: 97,
  factory: "0x00000000000000000000000000000000000000f1",
  fromBlock: b(1),
  scannedTo: b(scannedTo),
  latestBlock: b(scannedTo),
  chainNow: b(1_700_000_000),
  escrows: [],
  events: [],
  failed: {},
  scannedFailures: false,
  updatedAt: 0,
});

/** The server answers these scannedTo values in order, repeating the last one. */
function indexServer(...scannedTo: number[]) {
  const fetch = vi.fn(async () => new Response(encodeJson(snapshot(scannedTo.length > 1 ? scannedTo.shift()! : scannedTo[0])), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, url: (i: number) => new URL(String((fetch.mock.calls[i] as unknown[])[0]), "http://x") };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchChainIndex", () => {
  it("fetches once without a mined block of ours, and decodes the bigints", async () => {
    const srv = indexServer(100);
    const index = await fetchChainIndex(1001);
    expect(srv.fetch).toHaveBeenCalledTimes(1);
    expect(srv.url(0).searchParams.get("chainId")).toBe("1001");
    expect(srv.url(0).searchParams.has("minBlock")).toBe(false);
    expect(index.scannedTo).toBe(b(100));
  });

  it("asks again after 1.1 s until the index reaches our block", async () => {
    noteMinedBlock(1002, b(105));
    const srv = indexServer(100, 103, 105);
    const done = fetchChainIndex(1002);
    await vi.advanceTimersByTimeAsync(1_099);
    expect(srv.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(srv.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await done).scannedTo).toBe(b(105));
    expect(srv.fetch).toHaveBeenCalledTimes(3);
    expect(srv.url(2).searchParams.get("minBlock")).toBe("105");
  });

  it("returns at once when the first answer already includes our block", async () => {
    noteMinedBlock(1003, b(50));
    const srv = indexServer(60);
    expect((await fetchChainIndex(1003)).scannedTo).toBe(b(60));
    expect(srv.fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after 4 tries and returns the last (lagging) index", async () => {
    noteMinedBlock(1004, b(500));
    const srv = indexServer(100, 101, 102, 103, 104);
    const done = fetchChainIndex(1004);
    await vi.runAllTimersAsync();
    expect((await done).scannedTo).toBe(b(103));
    expect(srv.fetch).toHaveBeenCalledTimes(4);
  });

  it("keeps the highest mined block per chain", async () => {
    noteMinedBlock(1005, b(200));
    noteMinedBlock(1005, b(150));
    const srv = indexServer(300);
    await fetchChainIndex(1005);
    expect(srv.url(0).searchParams.get("minBlock")).toBe("200");
    await fetchChainIndex(1006);
    expect(srv.url(1).searchParams.has("minBlock")).toBe(false);
  });

  it("throws a ChainReadError with the server's message and Retry-After", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "rpc rate-limited" }), { status: 503, headers: { "retry-after": "7" } }));
    const err = await fetchChainIndex(1007).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainReadError);
    expect(err).toMatchObject({ message: "rpc rate-limited", status: 503, retryAfter: 7 });
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(fetchChainIndex(1007)).rejects.toMatchObject({ message: "chain read failed (HTTP 502)", status: 502, retryAfter: undefined });
  });
});
