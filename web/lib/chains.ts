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
 * Supported chains. Testnets and a local anvil node only: KeyEscrow is never deployed to mainnet
 * as part of the hackathon.
 */
export const supportedChains = [anvil, bscTestnet, opBNBTestnet] as const;

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
