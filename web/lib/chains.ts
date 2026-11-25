import { defineChain } from "viem";
import { bscTestnet, foundry, opBNBTestnet } from "viem/chains";

/** RPC of the local anvil node the browser talks to. */
export const anvilRpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? "http://127.0.0.1:8545";

/** Local anvil (chainId 31337), with the RPC taken from the environment. */
export const anvil = defineChain({
  ...foundry,
  name: "Anvil (local)",
  rpcUrls: { default: { http: [anvilRpcUrl] } },
});

/**
 * The chain this build targets: NEXT_PUBLIC_CHAIN_ID = 31337 (local anvil, default) or 97 (BSC testnet).
 * Addresses come from contracts/deployments/<chainId>.json (see lib/contracts).
 */
export const targetChainId: number = Number(process.env.NEXT_PUBLIC_CHAIN_ID || anvil.id);

/**
 * Supported chains, target first (wagmi's default when no wallet is connected). Testnets and a local anvil
 * node only: KeyEscrow is never deployed to mainnet as part of the hackathon. A testnet build does not list
 * anvil at all.
 */
export const supportedChains =
  targetChainId === anvil.id
    ? ([anvil, bscTestnet, opBNBTestnet] as const)
    : targetChainId === opBNBTestnet.id
      ? ([opBNBTestnet, bscTestnet] as const)
      : ([bscTestnet, opBNBTestnet] as const);

export type SupportedChainId = (typeof supportedChains)[number]["id"];

export function chainName(chainId: number): string {
  return supportedChains.find((c) => c.id === chainId)?.name ?? `chain ${chainId}`;
}

/** Block explorer base URL for a chain, or undefined for local anvil. */
export function explorerUrl(chainId: number): string | undefined {
  if (chainId === anvil.id) return undefined;
  const chain = supportedChains.find((c) => c.id === chainId);
  return chain?.blockExplorers?.default.url;
}

export function explorerLink(chainId: number, kind: "address" | "tx", value: string): string | undefined {
  const base = explorerUrl(chainId);
  return base ? `${base}/${kind}/${value}` : undefined;
}
