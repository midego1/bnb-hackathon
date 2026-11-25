"use client";

import { useCallback } from "react";
import type { Address, Hex } from "viem";
import { eventsOfLease, type ChainIndexResponse } from "../chainIndex";
import { useChainIndex } from "./useChainIndex";

export type TimelineEvent = {
  name: string;
  args: Record<string, unknown>;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: bigint;
};

/** Lease history (factory LeaseCreated + every escrow event), oldest first, from the shared server-side chain index. */
export function useLeaseEvents(address: Address | undefined) {
  const lease = address?.toLowerCase() ?? "";
  const select = useCallback((index: ChainIndexResponse): TimelineEvent[] => eventsOfLease(index.events, lease), [lease]);
  const q = useChainIndex(select);
  return address ? q : { ...q, data: undefined };
}
