"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { fleetVaultAbi, mockUsdtAbi } from "../contracts";
import { useDeployment } from "./useDeployment";

export type VaultState = {
  address: Address;
  name: string;
  symbol: string;
  operator: Address;
  operatorFeeBps: number;
  /** Tokens held (TVL). */
  totalAssets: bigint;
  totalSupply: bigint;
  totalPrincipal: bigint;
  reservedIncome: bigint;
  unsyncedIncome: bigint;
  totalDistributed: bigint;
  totalOperatorFees: bigint;
  totalClaimed: bigint;
  /** The connected wallet's position (zeros without a wallet). */
  me?: { shares: bigint; claimable: bigint; usdt: bigint; allowance: bigint; lockedUntil: bigint };
  /** Latest block timestamp and when it was read (the lock is judged on chain time, not the browser clock). */
  chainNow: bigint;
  fetchedAt: number;
};

export const vaultQueryKey = (chainId: number) => ["vault", chainId];

/** Live Fleet Vault figures (and the wallet's position), read from the contract every 8 s. */
export function useVault(who?: Address) {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  const vault = deployment?.fleetVault;
  return useQuery({
    queryKey: [...vaultQueryKey(chainId), vault, who?.toLowerCase()],
    enabled: !!client && !!vault,
    refetchInterval: 8_000,
    queryFn: async (): Promise<VaultState> => {
      const c = client!;
      const block = await c.getBlock();
      const r = <T,>(functionName: string, args: unknown[] = []) =>
        c.readContract({ address: vault!, abi: fleetVaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const [name, symbol, operator, operatorFeeBps, totalAssets, totalSupply, totalPrincipal, reservedIncome, unsyncedIncome, totalDistributed, totalOperatorFees, totalClaimed] =
        await Promise.all([
          r<string>("name"),
          r<string>("symbol"),
          r<Address>("operator"),
          r<number>("operatorFeeBps"),
          r<bigint>("totalAssets"),
          r<bigint>("totalSupply"),
          r<bigint>("totalPrincipal"),
          r<bigint>("reservedIncome"),
          r<bigint>("unsyncedIncome"),
          r<bigint>("totalDistributed"),
          r<bigint>("totalOperatorFees"),
          r<bigint>("totalClaimed"),
        ]);
      let me: VaultState["me"];
      if (who) {
        const [shares, claimable, usdt, allowance, lockedUntil] = await Promise.all([
          r<bigint>("balanceOf", [who]),
          r<bigint>("claimable", [who]),
          c.readContract({ address: deployment!.mockUsdt, abi: mockUsdtAbi, functionName: "balanceOf", args: [who] }),
          c.readContract({ address: deployment!.mockUsdt, abi: mockUsdtAbi, functionName: "allowance", args: [who, vault!] }),
          r<bigint>("lockedUntil", [who]),
        ]);
        me = { shares, claimable, usdt, allowance, lockedUntil };
      }
      return {
        address: vault!,
        name,
        symbol,
        operator,
        operatorFeeBps: Number(operatorFeeBps),
        totalAssets,
        totalSupply,
        totalPrincipal,
        reservedIncome,
        unsyncedIncome,
        totalDistributed,
        totalOperatorFees,
        totalClaimed,
        me,
        chainNow: block.timestamp,
        fetchedAt: Date.now(),
      };
    },
  });
}

/**
 * Shareholder income incl. not-yet-synced income (after the operator fee), as a share of principal: the simple,
 * un-annualised yield the dashboard shows.
 */
export function vaultIncome(v: VaultState) {
  const pendingNet = v.unsyncedIncome - (v.unsyncedIncome * BigInt(v.operatorFeeBps)) / BigInt(10_000);
  const earned = v.totalDistributed + pendingNet;
  const yieldPct = v.totalPrincipal > BigInt(0) ? (Number(earned) / Number(v.totalPrincipal)) * 100 : 0;
  return { earned, pendingNet, yieldPct };
}
