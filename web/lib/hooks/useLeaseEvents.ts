"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { escrowFactoryAbi, rentalEscrowAbi } from "../contracts";
import { useDeployment } from "./useDeployment";

export type TimelineEvent = {
  name: string;
  args: Record<string, unknown>;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: bigint;
};

/** Lease history straight from contract events (factory LeaseCreated + every escrow event). */
export function useLeaseEvents(address: Address | undefined) {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["leaseEvents", chainId, address?.toLowerCase()],
    enabled: !!client && !!deployment && !!address,
    refetchInterval: 8_000,
    queryFn: async (): Promise<TimelineEvent[]> => {
      const c = client!;
      const fromBlock = deployment!.fromBlock;
      const [created, own] = await Promise.all([
        c.getContractEvents({
          address: deployment!.escrowFactory,
          abi: escrowFactoryAbi,
          eventName: "LeaseCreated",
          args: { escrow: address! },
          fromBlock,
        }),
        c.getContractEvents({ address: address!, abi: rentalEscrowAbi, fromBlock }),
      ]);
      // `Initialized` is OpenZeppelin proxy plumbing, not part of the lease story.
      const logs = [...created, ...own].filter((l) => l.eventName !== "Initialized" && l.blockNumber !== null && l.transactionHash !== null);
      const blocks = [...new Set(logs.map((l) => l.blockNumber!))];
      const times = new Map<bigint, bigint>();
      await Promise.all(
        blocks.map(async (n) => times.set(n, (await c.getBlock({ blockNumber: n })).timestamp)),
      );
      return logs
        .map((l) => ({
          name: l.eventName,
          args: (l.args ?? {}) as Record<string, unknown>,
          txHash: l.transactionHash!,
          blockNumber: l.blockNumber!,
          logIndex: l.logIndex ?? 0,
          timestamp: times.get(l.blockNumber!) ?? BigInt(0),
        }))
        .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
    },
  });
}
