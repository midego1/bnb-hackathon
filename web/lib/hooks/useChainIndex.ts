"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchChainIndex, type ChainIndexResponse } from "../chainIndex";
import { useDeployment } from "./useDeployment";

export const chainIndexQueryKey = (chainId: number) => ["chainIndex", chainId];

/**
 * The server-side chain index (GET /api/chain/index) for the active chain: one request per page and poll, shared by
 * every component through react-query (same key), refreshed every 30 s (and at once after this tab's own transactions,
 * which invalidate it: useTx). `select` derives a view (rentals, one lease's
 * timeline); pass a stable (module-level) function so the derived value is memoised.
 */
export function useChainIndex<T = ChainIndexResponse>(select?: (index: ChainIndexResponse) => T) {
  const { chainId, deployment } = useDeployment();
  return useQuery({
    queryKey: chainIndexQueryKey(chainId),
    enabled: !!deployment,
    // Each poll returns the whole event history; at 8 s, a hundred open tabs would use up Workers Free's daily requests.
    refetchInterval: 30_000,
    // Our own route already retries the RPC with backoff; two more tries here cover a dropped request.
    retry: 2,
    retryDelay: (attempt) => Math.min(4_000, 750 * 2 ** attempt),
    queryFn: ({ signal }) => fetchChainIndex(chainId, signal),
    select,
  });
}
