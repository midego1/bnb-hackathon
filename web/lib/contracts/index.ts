import { getAddress, isAddress, type Address } from "viem";
import { targetChainId } from "../chains";
import deployments from "./deployments.generated.json";

export { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "./abis.generated";

/**
 * Where the contracts live on each chain. The single source of truth is the deploy script's output in
 * contracts/deployments/<chainId>.json, copied here by `pnpm sync:contracts`.
 */
export type Deployment = {
  escrowFactory: Address;
  mockUsdt: Address;
  /** KeyEscrow dispute desk: the default arbiter suggested for new rentals. */
  disputeDesk?: Address;
  /** First block worth scanning for events (factory deployment). */
  fromBlock: bigint;
};

const table = deployments as Record<string, { escrowFactory: string; mockUsdt: string; disputeDesk?: string; fromBlock?: number }>;

function envAddress(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? getAddress(v) : undefined;
}

/**
 * Optional overrides for the target chain (NEXT_PUBLIC_CHAIN_ID), e.g. right after a testnet deploy before
 * `pnpm sync:contracts` has picked up contracts/deployments/97.json.
 */
function envOverride(chainId: number) {
  if (chainId !== targetChainId) return undefined;
  const escrowFactory = envAddress(process.env.NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS);
  const mockUsdt = envAddress(process.env.NEXT_PUBLIC_MOCK_USDT_ADDRESS);
  return escrowFactory && mockUsdt ? { escrowFactory, mockUsdt } : undefined;
}

export function getDeployment(chainId: number | undefined): Deployment | undefined {
  if (chainId === undefined) return undefined;
  const override = envOverride(chainId);
  const file = table[String(chainId)];
  const raw = override
    ? { ...override, disputeDesk: undefined, fromBlock: 0, ...(file && file.escrowFactory.toLowerCase() === override.escrowFactory.toLowerCase() ? file : {}) }
    : file;
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
