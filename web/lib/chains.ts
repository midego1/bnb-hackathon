import { bscTestnet, foundry, opBNBTestnet } from "viem/chains";

/**
 * Supported chains. Testnets and a local anvil node only — KeyEscrow is never deployed to mainnet
 * as part of the hackathon.
 */
export const supportedChains = [foundry, bscTestnet, opBNBTestnet] as const;

export type SupportedChainId = (typeof supportedChains)[number]["id"];

/** Block explorer base URL for a chain, or undefined for local anvil. */
export function explorerUrl(chainId: number): string | undefined {
  const chain = supportedChains.find((c) => c.id === chainId);
  return chain?.blockExplorers?.default.url;
}
