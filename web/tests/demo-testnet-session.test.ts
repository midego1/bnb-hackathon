import { encodeFunctionData, encodeFunctionResult, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoServerError, fetchTestnetInfo, TestnetSession, type WaitInfo } from "@/lib/demo/testnet";

// Browser side of the live testnet demo (lib/demo/testnet.ts) against a mocked /api/demo-testnet server and a fake clock.

const LEASE = "0x00000000000000000000000000000000000000aa" as Address;
const TOKEN = "0x00000000000000000000000000000000000000c1" as Address;
const abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const approve = { address: TOKEN, abi, functionName: "approve", args: [LEASE, BigInt(5)] };

type Reply = { status?: number; body?: unknown };
type Handler = (body: Record<string, unknown>, init: RequestInit) => Reply;

/** A fake demo server: one handler per route (or a queue of them, used in order and the last one repeated). */
function server(routes: Record<string, Handler | Handler[]>) {
  const calls: { url: string; body: Record<string, unknown>; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body, init });
    const route = routes[url];
    if (!route) return new Response("{}", { status: 404 });
    const h = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]) : route;
    const r = h(body, init);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return { calls, urls: () => calls.map((c) => c.url) };
}

const ok = (body: unknown): Handler => () => ({ body });
const fail = (status: number, code: string, retryAfterSec?: number): Handler => () => ({ status, body: { error: `server says ${code}`, code, retryAfterSec } });
const started = (runId: string) => ok({ runId, topUps: [] });

function session(lease?: Address) {
  const waits: (WaitInfo | null)[] = [];
  const s = new TestnetSession({ lease: () => lease, onWait: (w) => waits.push(w) });
  return { s, waits };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TestnetSession.begin", () => {
  it("starts a run with this browser's owner id and the lease so far, and does not restart the same path", async () => {
    const topUps = [{ role: "tenant", amount: "0.01", hash: "0x01", url: "https://testnet.bscscan.com/tx/0x01" }];
    const srv = server({ "/api/demo-testnet/run": ok({ runId: "run-1", topUps }) });
    const { s, waits } = session(LEASE);
    expect(s.live).toBe(false);
    await s.begin("happy");
    expect(srv.calls[0].body).toEqual({ path: "happy", owner: s.owner, lease: LEASE });
    expect(s.owner).toMatch(/^[0-9a-zA-Z-]{8,64}$/);
    expect(s.runId).toBe("run-1");
    expect(s.topUps).toEqual(topUps);
    expect(s.live).toBe(true);
    expect(waits).toEqual([null]);
    await s.begin("happy");
    expect(srv.calls).toHaveLength(1);
  });

  it("waits while another visitor holds the lock, counting down through onWait, then starts", async () => {
    const srv = server({ "/api/demo-testnet/run": [fail(409, "busy", 3), started("run-2")] });
    const { s, waits } = session();
    const done = s.begin("dispute");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(srv.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(srv.calls).toHaveLength(2);
    expect(s.runId).toBe("run-2");
    expect(waits).toEqual([{ code: "busy", sec: 3 }, { code: "busy", sec: 2 }, { code: "busy", sec: 1 }, null]);
  });

  it("asks again every 10 s even when the server estimates a longer wait", async () => {
    const srv = server({ "/api/demo-testnet/run": [fail(429, "rate-limited", 45), started("run-3")] });
    const { s, waits } = session();
    const done = s.begin("happy");
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(srv.calls).toHaveLength(2);
    expect(waits[0]).toEqual({ code: "rate-limited", sec: 45 });
    expect(waits.at(-2)).toEqual({ code: "rate-limited", sec: 36 });
  });

  it("gives up at once on a wait over 5 minutes (the hourly cap) and on other errors", async () => {
    server({ "/api/demo-testnet/run": fail(429, "rate-limited", 301) });
    const { s, waits } = session();
    await expect(s.begin("happy")).rejects.toMatchObject({ name: "DemoServerError", code: "rate-limited", retryAfterSec: 301 });
    expect(waits).toEqual([null]);
    expect(s.live).toBe(false);

    server({ "/api/demo-testnet/run": fail(500, "boom") });
    await expect(session().s.begin("happy")).rejects.toThrow("server says boom");
  });

  it("stops retrying a lock that stays busy after about 10 minutes", async () => {
    const srv = server({ "/api/demo-testnet/run": fail(409, "busy", 300) });
    const { s, waits } = session();
    const done = expect(s.begin("happy")).rejects.toMatchObject({ code: "busy" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await done;
    // Asked at 0, 10, ..., 310 s; at 310 s another 300 s would pass the 10-minute limit.
    expect(srv.calls).toHaveLength(32);
    expect(waits.at(-1)).toBeNull();
  });

  it("says the demo is off when the route is missing (404)", async () => {
    server({});
    await expect(session().s.begin("happy")).rejects.toMatchObject({ code: "off", message: expect.stringMatching(/switched off/) });
  });
});

describe("TestnetSession.send / read", () => {
  const tx = (blockNumber: string) =>
    ok({ hash: "0xabc", status: "success", blockNumber, gasUsed: "21000", logs: [{ address: TOKEN, topics: [], data: "0x", logIndex: 0 }] });

  it("refuses before a run started", async () => {
    server({});
    await expect(session().s.send("tenant", approve)).rejects.toThrow(/has not started/);
  });

  it("posts the encoded call for the role and returns a receipt, keeping the highest block", async () => {
    const srv = server({ "/api/demo-testnet/run": started("run-1"), "/api/demo-testnet/tx": [tx("120"), tx("110")] });
    const { s } = session();
    await s.begin("happy");
    const receipt = await s.send("tenant", approve);
    expect(srv.calls[1].body).toEqual({ runId: "run-1", role: "tenant", address: TOKEN, data: encodeFunctionData({ abi, functionName: "approve", args: [LEASE, BigInt(5)] }) });
    expect(receipt).toMatchObject({ transactionHash: "0xabc", status: "success", blockNumber: BigInt(120), gasUsed: BigInt(21000) });
    expect(receipt.logs[0]).toMatchObject({ blockNumber: BigInt(120), transactionHash: "0xabc", removed: false });
    expect(s.lastBlock).toBe(BigInt(120));
    await s.send("tenant", approve);
    expect(s.lastBlock).toBe(BigInt(120)); // an older block never lowers it
  });

  it("decodes a read answered by the server", async () => {
    const data = encodeFunctionResult({ abi, functionName: "balanceOf", result: BigInt(42) });
    const srv = server({ "/api/demo-testnet/run": started("run-1"), "/api/demo-testnet/read": ok({ data }) });
    const { s } = session();
    await s.begin("happy");
    expect(await s.read<bigint>({ address: TOKEN, abi, functionName: "balanceOf", args: [LEASE] })).toBe(BigInt(42));
    expect(srv.calls[1].body).toMatchObject({ runId: "run-1", address: TOKEN });
  });

  it("resumes the lease in a new run once when the lock lapsed (run-gone), then retries the call", async () => {
    const srv = server({
      "/api/demo-testnet/run": [started("run-1"), started("run-2")],
      "/api/demo-testnet/tx": [fail(410, "run-gone"), tx("7")],
    });
    const { s } = session(LEASE);
    await s.begin("dispute");
    await s.send("landlord", approve);
    expect(srv.urls()).toEqual(["/api/demo-testnet/run", "/api/demo-testnet/tx", "/api/demo-testnet/run", "/api/demo-testnet/tx"]);
    expect(srv.calls[2].body).toMatchObject({ path: "dispute", lease: LEASE });
    expect(srv.calls[3].body.runId).toBe("run-2");
    expect(s.runId).toBe("run-2");
  });

  it("does not resume on other errors", async () => {
    const srv = server({ "/api/demo-testnet/run": started("run-1"), "/api/demo-testnet/tx": fail(400, "bad-call") });
    const { s } = session();
    await s.begin("happy");
    await expect(s.send("tenant", approve)).rejects.toBeInstanceOf(DemoServerError);
    expect(srv.calls).toHaveLength(2);
    expect(s.runId).toBe("run-1");
  });
});

describe("TestnetSession.ping / end / forget", () => {
  it("pings with the step error, never throws, and drops a run the server no longer has", async () => {
    const srv = server({ "/api/demo-testnet/run": started("run-1"), "/api/demo-testnet/ping": [fail(500, "boom"), fail(410, "run-gone")] });
    const { s } = session();
    await s.ping();
    expect(srv.calls).toHaveLength(0); // no run, no ping
    await s.begin("happy");
    await s.ping("step 3 failed");
    expect(srv.calls[1].body).toEqual({ runId: "run-1", error: "step 3 failed" });
    expect(s.live).toBe(true);
    await s.ping();
    expect(s.live).toBe(false);
  });

  it("ends with keepalive, swallows a failed end, and a new run waits for the end to land first", async () => {
    let releaseEnd!: () => void;
    const order: string[] = [];
    const srv = server({ "/api/demo-testnet/run": [started("run-1"), started("run-2")], "/api/demo-testnet/end": fail(500, "boom") });
    const { s } = session();
    await s.begin("happy");
    // Hold the end request open to see that begin waits for it.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      order.push(url);
      if (url !== "/api/demo-testnet/end") return realFetch(url, init);
      return new Promise<Response>((r) => (releaseEnd = () => r(realFetch(url, init))));
    });
    const ended = s.end("start over");
    expect(s.live).toBe(false);
    const begun = s.begin("happy");
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["/api/demo-testnet/end"]);
    releaseEnd();
    await ended; // the 500 is swallowed
    await begun;
    expect(order).toEqual(["/api/demo-testnet/end", "/api/demo-testnet/run"]);
    const end = srv.calls.find((c) => c.url === "/api/demo-testnet/end")!;
    expect(end.body).toEqual({ runId: "run-1", reason: "start over" });
    expect(end.init.keepalive).toBe(true);
    expect(s.runId).toBe("run-2");
  });

  it("end without a run and forget send nothing", async () => {
    const srv = server({ "/api/demo-testnet/run": started("run-1") });
    const { s } = session();
    await s.end();
    await s.begin("happy");
    s.forget();
    expect(s.live).toBe(false);
    await s.end();
    expect(srv.urls()).toEqual(["/api/demo-testnet/run"]);
  });
});

describe("fetchTestnetInfo", () => {
  it("is null when the demo is off, the status when on, and throws on a server error", async () => {
    server({});
    expect(await fetchTestnetInfo()).toBeNull();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ enabled: true, chainId: 97, busy: false }), { status: 200 }));
    expect(await fetchTestnetInfo()).toMatchObject({ enabled: true, chainId: 97, busy: false });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "rpc down", code: "rpc" }), { status: 503 }));
    await expect(fetchTestnetInfo()).rejects.toMatchObject({ message: "rpc down", code: "rpc" });
  });
});
