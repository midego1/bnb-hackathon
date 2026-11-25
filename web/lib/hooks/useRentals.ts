"use client";

import type { ChainIndexResponse } from "../chainIndex";
import { summarizeRentals, type ChainEvent, type RentalSummary } from "../rentals";
import { useChainIndex } from "./useChainIndex";

export type RentalIndex = {
  rentals: RentalSummary[];
  /** Every rental, vault and inflow event, oldest first. */
  events: ChainEvent[];
  /** Vault events (Deposited, IncomeDistributed, Claimed, Redeemed) and token transfers into the vault. */
  vaultEvents: ChainEvent[];
  chainNow: bigint;
  latestBlock: bigint;
  /** Whether reverted transactions were scanned for (local chain only; too heavy for a public RPC). */
  scannedFailures: boolean;
  /** Set when the server could not refresh and this is its last good snapshot. */
  stale?: ChainIndexResponse["stale"];
};

/** Folds the server's chain index into one summary per rental (pure, see lib/rentals.ts). */
export function toRentalIndex(index: ChainIndexResponse, vault?: string): RentalIndex {
  const failed = new Map(Object.entries(index.failed ?? {}));
  const v = vault?.toLowerCase();
  return {
    rentals: summarizeRentals(index.events, index.chainNow, failed),
    events: index.events,
    vaultEvents: v
      ? index.events.filter((e) => e.address.toLowerCase() === v || (e.name === "Transfer" && String(e.args.to).toLowerCase() === v))
      : [],
    chainNow: index.chainNow,
    latestBlock: index.latestBlock,
    scannedFailures: index.scannedFailures,
    stale: index.stale,
  };
}

const select = (index: ChainIndexResponse) => toRentalIndex(index, index.vault);

/**
 * Every rental of the factory with its full on-chain history, plus the Fleet Vault's activity, from the server-side
 * chain index (one request, no eth_getLogs in the browser). Polls every 8 s, so new transactions show up live.
 */
export function useRentals() {
  return useChainIndex(select);
}
