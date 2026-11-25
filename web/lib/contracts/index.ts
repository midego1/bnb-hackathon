import { getAddress, isAddress, type Address } from "viem";
import deployments from "./deployments.generated.json";

export { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "./abis.generated";

/**
 * Where the contracts live on each chain. The single source of truth is the deploy script's output in
 * contracts/deployments/<chainId>.json, copied here by `pnpm sync:contracts`.
 */
export type Deployment = {
  escrowFactory: Address;
  mockUsdt: Address;
  /** KeyEscrow dispute desk: the default arbiter suggested for new leases. */
  disputeDesk?: Address;
  /** First block worth scanning for events (factory deployment). */
  fromBlock: bigint;
};

const table = deployments as Record<string, { escrowFactory: string; mockUsdt: string; disputeDesk?: string; fromBlock?: number }>;

function envAddress(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? getAddress(v) : undefined;
}

export function getDeployment(chainId: number | undefined): Deployment | undefined {
  if (chainId === undefined) return undefined;
  const raw = table[String(chainId)];
  if (!raw) return undefined;
  return {
    escrowFactory: getAddress(raw.escrowFactory),
    mockUsdt: getAddress(raw.mockUsdt),
    disputeDesk: raw.disputeDesk
      ? getAddress(raw.disputeDesk)
      : envAddress(process.env.NEXT_PUBLIC_DISPUTE_DESK_ADDRESS),
    fromBlock: BigInt(raw.fromBlock ?? 0),
  };
}

/** USDT (and MockUSDT) use 6 decimals. */
export const USDT_DECIMALS = 6;

/** Mirrors RentalEscrow.Status. */
export const LeaseStatus = {
  Created: 0,
  Active: 1,
  MoveOut: 2,
  Disputed: 3,
  Settled: 4,
  Cancelled: 5,
} as const;
export type LeaseStatus = (typeof LeaseStatus)[keyof typeof LeaseStatus];

export const EvidenceKind = { CheckIn: 0, CheckOut: 1, Other: 2 } as const;
