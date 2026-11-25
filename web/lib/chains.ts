import { defineChain } from "viem";
import { bscTestnet as viemBscTestnet, foundry, opBNBTestnet as viemOpBNBTestnet } from "viem/chains";

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
 * BSC testnet RPC for the browser. viem's default (data-seed-prebsc-1-s1.bnbchain.org) answers every eth_getLogs
 * with "limit exceeded", which breaks the lease lists and timelines, so default to PublicNode (CORS, 50k-block logs).
 */
export const bscTestnetRpcUrl = process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";

/** BSC testnet (chainId 97) with that RPC, so "add network" in the wallet gets a working URL too. */
export const bscTestnet = defineChain({
  ...viemBscTestnet,
  rpcUrls: { default: { http: [bscTestnetRpcUrl] } },
});

/** opBNB testnet RPC for the browser (viem's default is BNB Chain's public endpoint). */
export const opBNBTestnetRpcUrl = process.env.NEXT_PUBLIC_OPBNB_TESTNET_RPC_URL || "https://opbnb-testnet-rpc.bnbchain.org";

/** opBNB testnet (chainId 5611), BNB Chain's L2: same contracts, explorer opBNBScan (testnet.opbnbscan.com). */
export const opBNBTestnet = defineChain({
  ...viemOpBNBTestnet,
  rpcUrls: { default: { http: [opBNBTestnetRpcUrl] } },
  blockExplorers: { default: { name: "opBNBScan", url: "https://testnet.opbnbscan.com" } },
});

/**
 * The chain this build targets: NEXT_PUBLIC_CHAIN_ID = 31337 (local anvil, default), 97 (BSC testnet) or
 * 5611 (opBNB testnet).
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

/** Block explorer name ("BscScan", "opBNBScan"), or undefined for local anvil. */
export function explorerName(chainId: number): string | undefined {
  return chainId === anvil.id ? undefined : supportedChains.find((c) => c.id === chainId)?.blockExplorers?.default.name;
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
