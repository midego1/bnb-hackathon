"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, Hex, PublicClient } from "viem";
import { escrowFactoryAbi, fleetVaultAbi, mockUsdtAbi, rentalEscrowAbi } from "../contracts";
import { inBlockWindows } from "../logs";
import { summarizeRentals, type ChainEvent, type RentalSummary } from "../rentals";
import { useDeployment } from "./useDeployment";

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
};

type RawLog = { address: Address; eventName?: string; args?: unknown; transactionHash: Hex | null; blockNumber: bigint | null; logIndex: number | null };

function toEvents(logs: RawLog[], times: Map<bigint, bigint>): ChainEvent[] {
  return logs
    .filter((l) => l.eventName && l.eventName !== "Initialized" && l.blockNumber !== null && l.transactionHash !== null)
    .map((l) => ({
      address: l.address,
      name: l.eventName!,
      args: (l.args ?? {}) as Record<string, unknown>,
      txHash: l.transactionHash!,
      blockNumber: l.blockNumber!,
      logIndex: l.logIndex ?? 0,
      timestamp: times.get(l.blockNumber!) ?? BigInt(0),
    }));
}

/** Block timestamps for the newest `limit` distinct blocks (older ones stay 0 to spare public RPCs). */
async function blockTimes(c: PublicClient, blocks: bigint[], limit = 250) {
  const uniq = [...new Set(blocks)].sort((a, b) => (a < b ? 1 : -1)).slice(0, limit);
  const times = new Map<bigint, bigint>();
  for (let i = 0; i < uniq.length; i += 25) {
    await Promise.all(uniq.slice(i, i + 25).map(async (n) => times.set(n, (await c.getBlock({ blockNumber: n })).timestamp)));
  }
  return times;
}

/** Reverted escrow transactions per block, cached: mined blocks never change (reset when the chain restarts). */
const failureCache = new Map<bigint, { to: string; hash: Hex }[]>();

/** Local anvil only: reverted transactions sent to a rental escrow (they emit no events, so logs alone miss them). */
async function scanFailures(c: PublicClient, from: bigint, to: bigint, leases: Set<string>) {
  const cached = [...failureCache.keys()];
  if (cached.length && cached.some((n) => n > to)) failureCache.clear();
  const start = to - from > BigInt(2_000) ? to - BigInt(2_000) : from;
  const todo: bigint[] = [];
  for (let n = start; n <= to; n += BigInt(1)) if (!failureCache.has(n)) todo.push(n);
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(
      todo.slice(i, i + 20).map(async (n) => {
        const block = await c.getBlock({ blockNumber: n, includeTransactions: true });
        const reverted: { to: string; hash: Hex }[] = [];
        for (const tx of block.transactions) {
          if (!tx.to) continue;
          const receipt = await c.getTransactionReceipt({ hash: tx.hash });
          if (receipt.status === "reverted") reverted.push({ to: tx.to.toLowerCase(), hash: tx.hash });
        }
        failureCache.set(n, reverted);
      }),
    );
  }
  const failed = new Map<string, Hex[]>();
  for (const [n, list] of failureCache) {
    if (n < start || n > to) continue;
    for (const f of list) if (leases.has(f.to)) failed.set(f.to, [...(failed.get(f.to) ?? []), f.hash]);
  }
  return failed;
}

/**
 * Every rental of the factory with its full on-chain history, plus the Fleet Vault's activity, read straight from
 * contract events (nothing hardcoded or cached server-side). Polls every 8 s, so new transactions show up live.
 */
export function useRentals() {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["rentals", chainId, deployment?.escrowFactory],
    enabled: !!client && !!deployment,
    refetchInterval: 8_000,
    queryFn: async (): Promise<RentalIndex> => {
      const c = client!;
      const d = deployment!;
      const from = d.fromBlock;
      const [created, payees] = await Promise.all([
        inBlockWindows(c, from, (range) => c.getContractEvents({ address: d.escrowFactory, abi: escrowFactoryAbi, eventName: "LeaseCreated", ...range })),
        // Older factories have no PayeeSet event; the query then simply returns nothing.
        inBlockWindows(c, from, (range) => c.getContractEvents({ address: d.escrowFactory, abi: escrowFactoryAbi, eventName: "PayeeSet", ...range })).catch(() => []),
      ]);
      const leases = created.map((l) => (l.args as { escrow: Address }).escrow);
      const [escrowLogs, vaultLogs, inflowLogs] = await Promise.all([
        leases.length
          ? inBlockWindows(c, from, (range) => c.getContractEvents({ address: leases, abi: rentalEscrowAbi, ...range }))
          : Promise.resolve([]),
        d.fleetVault ? inBlockWindows(c, from, (range) => c.getContractEvents({ address: d.fleetVault!, abi: fleetVaultAbi, ...range })) : Promise.resolve([]),
        d.fleetVault
          ? inBlockWindows(c, from, (range) =>
              c.getContractEvents({ address: d.mockUsdt, abi: mockUsdtAbi, eventName: "Transfer", args: { to: d.fleetVault! }, ...range }),
            )
          : Promise.resolve([]),
      ]);
      // The vault's own share-token Transfer events (mint/burn) are noise next to Deposited / Redeemed.
      const vaultOnly = (vaultLogs as RawLog[]).filter((l) => l.eventName !== "Transfer" && l.eventName !== "Approval");
      // Income only: transfers into the vault from rental escrows (investor deposits are principal, not inflow).
      const leaseSet = new Set(leases.map((l) => l.toLowerCase()));
      const income = (inflowLogs as RawLog[]).filter((l) => leaseSet.has(String((l.args as { from?: string }).from).toLowerCase()));
      const all = [...created, ...payees, ...escrowLogs, ...vaultOnly, ...income] as RawLog[];
      const latest = await c.getBlock();
      const times = await blockTimes(c, all.map((l) => l.blockNumber!).filter((b) => b !== null));
      const events = toEvents(all, times).sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
      const local = chainId === 31337;
      const failed = local ? await scanFailures(c, from, latest.number, new Set(leases.map((l) => l.toLowerCase()))) : new Map();
      const vaultAddr = d.fleetVault?.toLowerCase();
      return {
        rentals: summarizeRentals(events, latest.timestamp, failed),
        events,
        vaultEvents: events.filter((e) => e.address.toLowerCase() === vaultAddr || (e.name === "Transfer" && String(e.args.to).toLowerCase() === vaultAddr)),
        chainNow: latest.timestamp,
        latestBlock: latest.number,
        scannedFailures: local,
      };
    },
  });
}
