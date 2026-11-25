import { encodeFunctionData, type Address, type Hex, type TransactionReceipt } from "viem";
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

/** Paths that can run on a real chain: "landlord ignores it" needs 7 days of real time. */
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

/** A rate-limit gap this short is waited out by the client (the step shows "working…" meanwhile). */
const AUTO_WAIT_SEC = 30;

/** One live run: the server lock is taken on the first `begin`, freed by `end` (or by the server after 2 idle minutes). */
export class TestnetSession {
  runId: string | undefined;
  path: DemoPath | undefined;
  /** Block of the latest receipt: reads are pinned to it so a lagging RPC backend cannot serve stale state. */
  lastBlock = BigInt(0);
  topUps: TopUp[] = [];
  /** The last `end` request: a new run waits for it, so the server sees the old lock freed first. */
  private ending: Promise<unknown> = Promise.resolve();

  async begin(path: DemoPath) {
    if (this.runId && this.path === path) return;
    await this.end();
    await this.ending;
    const start = () => post<{ runId: string; topUps: TopUp[] }>("/api/demo-testnet/run", { path });
    let r: Awaited<ReturnType<typeof start>>;
    try {
      r = await start();
    } catch (e) {
      // "Try the dispute path" right after a run: wait out a short gap instead of failing the first step.
      const wait = e instanceof DemoServerError && e.code === "rate-limited" ? (e.retryAfterSec ?? 99) : 99;
      if (wait > AUTO_WAIT_SEC) throw e;
      await new Promise((ok) => setTimeout(ok, wait * 1000 + 500));
      r = await start();
    }
    this.runId = r.runId;
    this.path = path;
    this.topUps = r.topUps;
  }

  /** Sign and send `call` as `role` on chain 97 (server-side), and return the receipt the server waited for. */
  async send(role: DevRole, call: Call): Promise<TransactionReceipt> {
    if (!this.runId) throw new DemoServerError("The live run has not started. Start over.");
    const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] } as never);
    const r = await post<TxResult>("/api/demo-testnet/tx", { runId: this.runId, role, address: call.address, data });
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

  async end() {
    const runId = this.runId;
    this.runId = undefined;
    this.path = undefined;
    if (!runId) return;
    // keepalive: still delivered when the page is being closed.
    this.ending = post("/api/demo-testnet/end", { runId }, { keepalive: true }).catch(() => undefined);
    await this.ending;
  }
}
