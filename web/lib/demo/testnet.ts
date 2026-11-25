import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type TransactionReceipt } from "viem";
import type { DevRole } from "../devAccounts";
import type { DemoPath } from "./script";

/**
 * Browser side of the live BSC testnet demo. The browser holds no key: every transaction of the story is sent to
 * POST /api/demo-testnet/tx, which signs it on chain 97 with the server's demo wallets (lib/server/demoTestnet) and
 * answers once the block is in. One request per transaction, so the stage shows each one as it confirms.
 */

export const BSCSCAN = "https://testnet.bscscan.com";
export const bscscanTx = (hash: string) => `${BSCSCAN}/tx/${hash}`;
export const bscscanAddress = (address: string) => `${BSCSCAN}/address/${address}`;

/** Paths that can run on a real chain: "owner ignores it" needs 7 days of real time. */
export const testnetPaths: readonly DemoPath[] = ["happy", "dispute"];

export type TestnetInfo = {
  enabled: true;
  chainId: 97;
  accounts: Record<DevRole, Address>;
  busy: boolean;
  waitSec: number;
  gasPriceGwei: string;
  maxGasPerRun: string;
  maxCostTbnb: string;
};

export type TopUp = { role: DevRole; amount: string; hash: Hex; url: string };

export class DemoServerError extends Error {
  readonly code?: string;
  readonly retryAfterSec?: number;
  constructor(message: string, code?: string, retryAfterSec?: number) {
    super(message);
    this.name = "DemoServerError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

async function post<T>(url: string, body: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new DemoServerError("The live testnet demo is switched off on this server.", "off");
    throw new DemoServerError(json.error ?? `The demo server answered ${res.status}.`, json.code, json.retryAfterSec);
  }
  return json as T;
}

/** The runner's status, or null when the live testnet demo is off on this server (the route answers 404). */
export async function fetchTestnetInfo(): Promise<TestnetInfo | null> {
  const res = await fetch("/api/demo-testnet", { cache: "no-store" });
  if (res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new DemoServerError(json.error ?? `The demo server answered ${res.status}.`, json.code);
  return json as TestnetInfo;
}

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };

type TxResult = {
  hash: Hex;
  status: "success" | "reverted";
  blockNumber: string;
  gasUsed: string;
  logs: { address: Address; topics: Hex[]; data: Hex; logIndex: number | null }[];
};

/** Waiting for the lock or the rate limit: what the stage tells the viewer while it retries by itself. */
export type WaitInfo = { code: "busy" | "rate-limited"; sec: number };

/** Give up waiting after this long (someone left a run paused, or the hourly cap is hit). */
const MAX_WAIT_MS = 10 * 60_000;
const OWNER_KEY = "keyescrow.demoOwner";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** A random id for this browser, so Start over (or a second tab) takes over its own run instead of waiting for it. */
function ownerId(): string {
  const fresh = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^0-9a-zA-Z-]/g, "");
  try {
    const v = globalThis.localStorage?.getItem(OWNER_KEY);
    if (v && /^[0-9a-zA-Z-]{8,64}$/.test(v)) return v;
    const id = fresh();
    globalThis.localStorage?.setItem(OWNER_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

/**
 * One live run. The server lock is taken on the first `begin` and kept by `ping` (every 10 s while the stage plays);
 * `end` frees it, and without pings the server frees it after 45 s (tab closed, error screen). When another visitor
 * holds it, `begin` waits and retries by itself, reporting the countdown through `onWait`.
 */
export class TestnetSession {
  runId: string | undefined;
  path: DemoPath | undefined;
  /** Block of the latest receipt: reads are pinned to it so a lagging RPC backend cannot serve stale state. */
  lastBlock = BigInt(0);
  topUps: TopUp[] = [];
  readonly owner = ownerId();
  /** The last `end` request: a new run waits for it, so the server sees the old lock freed first. */
  private ending: Promise<unknown> = Promise.resolve();
  private readonly lease: () => Address | undefined;
  private readonly onWait: (w: WaitInfo | null) => void;

  /** `lease`: the story's lease so far, so a run whose lock lapsed carries on with it. */
  constructor(opts: { lease: () => Address | undefined; onWait: (w: WaitInfo | null) => void }) {
    this.lease = opts.lease;
    this.onWait = opts.onWait;
  }

  async begin(path: DemoPath) {
    if (this.runId && this.path === path) return;
    await this.ending;
    this.path = path;
    const t0 = Date.now();
    try {
      for (;;) {
        try {
          const r = await post<{ runId: string; topUps: TopUp[] }>("/api/demo-testnet/run", { path, owner: this.owner, lease: this.lease() });
          this.runId = r.runId;
          this.topUps = r.topUps;
          return;
        } catch (e) {
          const code = e instanceof DemoServerError ? e.code : undefined;
          if (code !== "busy" && code !== "rate-limited") throw e;
          const wait = (e as DemoServerError).retryAfterSec ?? 10;
          if (wait > 300 || Date.now() - t0 + wait * 1000 > MAX_WAIT_MS) throw e; // e.g. the hourly cap: say so
          // Count down the estimate, and ask again every 10 s: the other run may end sooner.
          const t1 = Date.now();
          while (Date.now() - t1 < Math.min(wait, 10) * 1000) {
            this.onWait({ code, sec: Math.max(1, wait - Math.floor((Date.now() - t1) / 1000)) });
            await sleep(1000);
          }
        }
      }
    } finally {
      this.onWait(null);
    }
  }

  /** Runs `fn` for this run; if its lock lapsed (a long pause, a background tab), resumes the lease in a new run once. */
  private async withRun<T>(fn: (runId: string) => Promise<T>): Promise<T> {
    if (!this.runId || !this.path) throw new DemoServerError("The live run has not started. Start over.");
    try {
      return await fn(this.runId);
    } catch (e) {
      if (!(e instanceof DemoServerError) || e.code !== "run-gone") throw e;
      this.runId = undefined;
      await this.begin(this.path);
      return fn(this.runId!);
    }
  }

  /** True while this browser holds a live run (reads then go through the server, see `read`). */
  get live() {
    return !!this.runId;
  }

  /**
   * A contract read through the server (POST /api/demo-testnet/read), at the block of the run's latest receipt and
   * on the RPC that mined it: a viewer's own route to a public RPC may lag behind and fail block-pinned reads.
   */
  async read<T>(call: Call): Promise<T> {
    const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] } as never);
    const r = await this.withRun((runId) => post<{ data: Hex }>("/api/demo-testnet/read", { runId, address: call.address, data }));
    return decodeFunctionResult({ abi: call.abi, functionName: call.functionName, data: r.data } as never) as T;
  }

  /** Sign and send `call` as `role` on chain 97 (server-side), and return the receipt the server waited for. */
  async send(role: DevRole, call: Call): Promise<TransactionReceipt> {
    const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] } as never);
    const r = await this.withRun((runId) => post<TxResult>("/api/demo-testnet/tx", { runId, role, address: call.address, data }));
    const blockNumber = BigInt(r.blockNumber);
    if (blockNumber > this.lastBlock) this.lastBlock = blockNumber;
    return {
      transactionHash: r.hash,
      status: r.status,
      blockNumber,
      gasUsed: BigInt(r.gasUsed),
      logs: r.logs.map((l) => ({ ...l, blockNumber, transactionHash: r.hash, removed: false })),
    } as unknown as TransactionReceipt;
  }

  /** Heartbeat while the stage plays; `error` reports the step error the viewer sees (server log only). */
  async ping(error?: string) {
    const runId = this.runId;
    if (!runId) return;
    try {
      await post("/api/demo-testnet/ping", { runId, error });
    } catch (e) {
      if (e instanceof DemoServerError && e.code === "run-gone" && this.runId === runId) this.runId = undefined; // resumes on the next step
    }
  }

  /** Drop the run here without freeing it: the next `begin` from this browser takes it over (Start over). */
  forget() {
    this.runId = undefined;
  }

  async end(reason?: string) {
    const runId = this.runId;
    this.runId = undefined;
    if (!runId) return;
    // keepalive: still delivered when the page is being closed.
    this.ending = post("/api/demo-testnet/end", { runId, reason }, { keepalive: true }).catch(() => undefined);
    await this.ending;
  }
}
