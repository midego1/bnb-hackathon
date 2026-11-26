"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, Hex, PublicClient } from "viem";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi, type LeaseStatus } from "../contracts";
import { useDeployment } from "./useDeployment";

export type LeaseTerms = {
  token: Address;
  landlord: Address;
  tenant: Address;
  arbiter: Address;
  rentAmount: bigint;
  depositAmount: bigint;
  termPeriods: number;
  /** Seconds per rent period: 7, 14 or 30 days. */
  rentPeriod: number;
  responseWindow: number;
  arbiterWindow: number;
  leaseHash: Hex;
  feeBps: number;
  feeRecipient: Address;
};

export type LeaseProposal = {
  tenantRefund: bigint;
  landlordClaim: bigint;
  reportHash: Hex;
  proposer: Address;
  proposedAt: bigint;
  nonce: number;
};

export type LeaseData = {
  address: Address;
  terms: LeaseTerms;
  status: LeaseStatus;
  startTime: bigint;
  periodsFunded: number;
  periodsReleased: number;
  periodsDue: number;
  checkInHash: Hex;
  checkOutHash: Hex;
  proposal: LeaseProposal;
  timeoutAt: bigint;
  /** While disputed: when the arbiter-deadline fallback opens (0 otherwise). */
  arbiterDeadline: bigint;
  disputedAt: bigint;
  /** The one-time protocol fee has already been taken from a rent payout. */
  feeCharged: boolean;
  /** USDT held by the escrow right now. */
  balance: bigint;
  /** Chain timestamp of the block the data was read at. */
  chainNow: bigint;
  /** Wall-clock ms when this snapshot was read. */
  fetchedAt: number;
};

export const leaseQueryKey = (chainId: number, address: string) => ["lease", chainId, address.toLowerCase()];

/**
 * The chain head, shared for ~2 s by every rental card and panel on a page (one eth_getBlockByNumber instead of one per
 * card). Exported for hooks that need the chain's "now".
 */
export function chainHead(queryClient: QueryClient, chainId: number, client: PublicClient) {
  return queryClient.fetchQuery({ queryKey: ["chainHead", chainId], queryFn: () => client.getBlock(), staleTime: 2_000 });
}

/**
 * One rental's live state. All reads go out in the same tick, so wagmi's multicall batching (Multicall3 on BSC
 * testnet) turns them, and those of every other card on the page, into a single eth_call.
 */
export function useLease(address: Address | undefined) {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: leaseQueryKey(chainId, address ?? ""),
    enabled: !!client && !!address,
    refetchInterval: 8_000,
    queryFn: async (): Promise<LeaseData> => {
      const c = client!;
      const a = address!;
      const r = <T,>(functionName: string, args: unknown[] = []) =>
        c.readContract({ address: a, abi: rentalEscrowAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const balanceIn = (token: Address) => c.readContract({ address: token, abi: mockUsdtAbi, functionName: "balanceOf", args: [a] });
      const [block, terms, status, startTime, periodsFunded, periodsReleased, periodsDue, checkInHash, checkOutHash, proposal, timeoutAt, arbiterDeadline, disputedAt, feeCharged, tokenBalance] =
        await Promise.all([
          chainHead(queryClient, chainId, c as PublicClient),
          r<LeaseTerms>("terms"),
          r<number>("status"),
          r<bigint>("startTime"),
          r<number>("periodsFunded"),
          r<number>("periodsReleased"),
          r<number>("periodsDue"),
          r<Hex>("checkInHash"),
          r<Hex>("checkOutHash"),
          r<LeaseProposal>("proposal"),
          r<bigint>("timeoutAt"),
          r<bigint>("arbiterDeadline"),
          r<bigint>("disputedAt"),
          r<boolean>("feeCharged"),
          // The escrow's token is the deployment's stablecoin; read it in the same batch (checked against terms below).
          deployment ? balanceIn(deployment.mockUsdt) : Promise.resolve(undefined),
        ]);
      const balance =
        tokenBalance !== undefined && deployment && terms.token.toLowerCase() === deployment.mockUsdt.toLowerCase() ? tokenBalance : await balanceIn(terms.token);
      return {
        address: a,
        terms,
        status: status as LeaseStatus,
        startTime,
        periodsFunded,
        periodsReleased,
        periodsDue,
        checkInHash,
        checkOutHash,
        proposal,
        timeoutAt,
        arbiterDeadline,
        disputedAt,
        feeCharged,
        balance,
        chainNow: block.timestamp,
        fetchedAt: Date.now(),
      };
    },
  });
}

export type LeaseListRole = "landlord" | "tenant" | "arbiter";

const listFn = {
  landlord: "leasesByLandlord",
  tenant: "leasesByTenant",
  arbiter: "leasesByArbiter",
} as const;

/** Lease addresses where `who` has `role`, newest first. Read straight from the factory index. */
export function useLeaseList(role: LeaseListRole, who: Address | undefined) {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["leases", chainId, role, who?.toLowerCase()],
    enabled: !!client && !!deployment && !!who,
    refetchInterval: 8_000,
    queryFn: async () => {
      const list = await client!.readContract({
        address: deployment!.escrowFactory,
        abi: escrowFactoryAbi,
        functionName: listFn[role],
        args: [who!],
      });
      return [...list].reverse();
    },
  });
}
