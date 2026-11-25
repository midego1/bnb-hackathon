import type { Address, Hex } from "viem";
import type { ChainEvent } from "./rentals";

/**
 * What GET /api/chain/index returns: every factory, rental escrow and Fleet Vault event of one deployment, plus the
 * vault's income transfers, scanned once on the server (lib/server/chainIndex) and shared by every page. The browser
 * folds it into rentals with lib/rentals.ts, so no page needs eth_getLogs of its own.
 */
export type ChainIndexSnapshot = {
  chainId: number;
  factory: Address;
  /** Fleet Vault of this deployment, if it has one. */
  vault?: Address;
  fromBlock: bigint;
  /** Last block whose logs are included. */
  scannedTo: bigint;
  latestBlock: bigint;
  /** Timestamp of `latestBlock`: the chain's "now" for deadlines and flags. */
  chainNow: bigint;
  /** Every rental escrow created by the factory, oldest first. */
  escrows: Address[];
  /** Factory, escrow and vault events and token transfers into the vault from escrows, oldest first. */
  events: ChainEvent[];
  /** Local anvil only: reverted transactions per escrow (lowercase), which emit no events. */
  failed: Record<string, Hex[]>;
  scannedFailures: boolean;
  /** Wall-clock ms of the last successful refresh. */
  updatedAt: number;
};

export type ChainIndexResponse = ChainIndexSnapshot & {
  /** Set when the latest refresh failed and this is the last good snapshot. */
  stale?: { error: string; since: number };
};

// ---------------------------------------------------------------------------------------------------------
// JSON with bigints: {"$n": "123"} on the wire.
// ---------------------------------------------------------------------------------------------------------

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $n: v.toString() } : v));
}

export function decodeJson<T>(text: string): T {
  return JSON.parse(text, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) && typeof v.$n === "string" && Object.keys(v).length === 1 ? BigInt(v.$n) : v)) as T;
}

/** The events that belong to one rental: its factory LeaseCreated / PayeeSet and everything the escrow emitted. */
export function eventsOfLease(events: ChainEvent[], lease: string): ChainEvent[] {
  const l = lease.toLowerCase();
  return events.filter((e) =>
    e.name === "LeaseCreated" || e.name === "PayeeSet" ? String(e.args.escrow).toLowerCase() === l : e.address.toLowerCase() === l && e.name !== "Transfer",
  );
}

/** Thrown by the browser fetch when the server could not read the chain; `retryAfter` in seconds. */
export class ChainReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ChainReadError";
  }
}

/**
 * Highest block a transaction of this tab was mined in, per chain. Sent as `minBlock` so the server refreshes past
 * its cache right after one of our own transactions, instead of serving a snapshot from before it.
 */
const minBlocks = new Map<number, bigint>();
export function noteMinedBlock(chainId: number, block: bigint) {
  if (block > (minBlocks.get(chainId) ?? BigInt(0))) minBlocks.set(chainId, block);
}

export async function fetchChainIndex(chainId: number, signal?: AbortSignal): Promise<ChainIndexResponse> {
  const min = minBlocks.get(chainId);
  // Right after our own transaction the server may answer from a snapshot of a second ago: ask again shortly (a few
  // times at most) until the index includes that block.
  for (let i = 0; ; i++) {
    const index = await fetchOnce(chainId, min, signal);
    if (!min || index.scannedTo >= min || i >= 3) return index;
    await new Promise((r) => setTimeout(r, 1_100));
  }
}

async function fetchOnce(chainId: number, min: bigint | undefined, signal?: AbortSignal): Promise<ChainIndexResponse> {
  const qs = new URLSearchParams({ chainId: String(chainId), ...(min ? { minBlock: min.toString() } : {}) });
  const res = await fetch(`/api/chain/index?${qs}`, { signal, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    let message = `chain read failed (HTTP ${res.status})`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {}
    throw new ChainReadError(message, res.status, Number(res.headers.get("retry-after")) || undefined);
  }
  return decodeJson<ChainIndexResponse>(text);
}
