"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi, type LeaseStatus } from "../contracts";
import { useDeployment } from "./useDeployment";

export type LeaseTerms = {
  token: Address;
  landlord: Address;
  tenant: Address;
  arbiter: Address;
  rentAmount: bigint;
  depositAmount: bigint;
  termMonths: number;
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
  monthsFunded: number;
  monthsReleased: number;
  monthsDue: number;
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

export function useLease(address: Address | undefined) {
  const { chainId } = useDeployment();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: leaseQueryKey(chainId, address ?? ""),
    enabled: !!client && !!address,
    refetchInterval: 8_000,
    queryFn: async (): Promise<LeaseData> => {
      const c = client!;
      const a = address!;
      const r = <T,>(functionName: string, args: unknown[] = []) =>
        c.readContract({ address: a, abi: rentalEscrowAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const block = await c.getBlock();
      const [terms, status, startTime, monthsFunded, monthsReleased, monthsDue, checkInHash, checkOutHash, proposal, timeoutAt, arbiterDeadline, disputedAt, feeCharged] =
        await Promise.all([
          r<LeaseTerms>("terms"),
          r<number>("status"),
          r<bigint>("startTime"),
          r<number>("monthsFunded"),
          r<number>("monthsReleased"),
          r<number>("monthsDue"),
          r<Hex>("checkInHash"),
          r<Hex>("checkOutHash"),
          r<LeaseProposal>("proposal"),
          r<bigint>("timeoutAt"),
          r<bigint>("arbiterDeadline"),
          r<bigint>("disputedAt"),
          r<boolean>("feeCharged"),
        ]);
      const balance = await c.readContract({
        address: terms.token,
        abi: mockUsdtAbi,
        functionName: "balanceOf",
        args: [a],
      });
      return {
        address: a,
        terms,
        status: status as LeaseStatus,
        startTime,
        monthsFunded,
        monthsReleased,
        monthsDue,
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
