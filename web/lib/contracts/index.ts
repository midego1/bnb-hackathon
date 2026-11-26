import { getAddress, isAddress, type Address } from "viem";
import { targetChainId } from "../chains";
import deployments from "./deployments.generated.json";

export { escrowFactoryAbi, fleetVaultAbi, mockUsdtAbi, rentalEscrowAbi } from "./abis.generated";

/**
 * Where the contracts live on each chain. The single source of truth is the deploy script's output in
 * contracts/deployments/<chainId>.json, copied here by `pnpm sync:contracts`.
 */
export type Deployment = {
  escrowFactory: Address;
  mockUsdt: Address;
  /** KeyScrow dispute desk: the default arbiter suggested for new rentals. */
  disputeDesk?: Address;
  /** Fleet Vault (BKK-FLEET-1 shares); absent on deployments made before the vault existed. */
  fleetVault?: Address;
  /** Testnet "Pay with BNB" demo swap at the Atlas price (contracts/script/DeployAtlasSwapGuard.s.sol); never on 56. */
  atlasSwapGuard?: Address;
  /** First block worth scanning for events (factory deployment). */
  fromBlock: bigint;
  /** The stablecoin's decimals() and symbol(), read from the token by the deploy script. */
  tokenDecimals: number;
  tokenSymbol: string;
};

type Row = { escrowFactory: string; mockUsdt: string; disputeDesk?: string; fleetVault?: string; atlasSwapGuard?: string; fromBlock?: number; tokenDecimals: number; tokenSymbol?: string };
const table = deployments as Record<string, Row>;

/**
 * The stablecoin of the chain this build targets (NEXT_PUBLIC_CHAIN_ID): MockUSDT (6 decimals) on anvil and the
 * testnets, BSC-USD (18) on BSC mainnet. Every amount in the app is parsed and formatted with it. Without a
 * deployment for the target chain nothing can be priced; the ERC-20 default (18) is then only a placeholder.
 */
export const TOKEN = {
  symbol: table[String(targetChainId)]?.tokenSymbol ?? "USDT",
  decimals: table[String(targetChainId)]?.tokenDecimals ?? 18,
} as const;

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
    ? { ...override, disputeDesk: undefined, fromBlock: 0, tokenDecimals: TOKEN.decimals, tokenSymbol: TOKEN.symbol, ...(file && file.escrowFactory.toLowerCase() === override.escrowFactory.toLowerCase() ? file : {}) }
    : file;
  if (!raw) return undefined;
  return {
    escrowFactory: getAddress(raw.escrowFactory),
    mockUsdt: getAddress(raw.mockUsdt),
    disputeDesk: raw.disputeDesk
      ? getAddress(raw.disputeDesk)
      : envAddress(process.env.NEXT_PUBLIC_DISPUTE_DESK_ADDRESS),
    fleetVault:
      (chainId === targetChainId ? envAddress(process.env.NEXT_PUBLIC_FLEET_VAULT_ADDRESS) : undefined) ??
      (raw.fleetVault ? getAddress(raw.fleetVault) : undefined),
    atlasSwapGuard: raw.atlasSwapGuard ? getAddress(raw.atlasSwapGuard) : undefined,
    fromBlock: BigInt(raw.fromBlock ?? 0),
    tokenDecimals: raw.tokenDecimals,
    tokenSymbol: raw.tokenSymbol ?? "USDT",
  };
}

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
