import { zeroAddress, type Address } from "viem";

/**
 * Atlas (CoinMarketCap's oracle) guard for "Pay with BNB": pure, client-safe. The server reads the Atlas BNB/USD push
 * feed and the Pull API consensus (lib/server/price/atlas.ts) and serves them as `atlas` on GET /api/price.
 */

export const ATLAS_FEED_IDS = { BNB_USD: 633, USDT_USD: 649 } as const;
/** Atlas Oracle production signing key (docs.atlasoracle.io, pull mode reference hooks). */
export const ATLAS_SIGNER: Address = "0x59eD4701224fD9e2a85Ef2946c2ab828C1dDC600";
/** Consensus states a swap may run on; WARNING, CRITICAL and SPLIT_MARKET refuse. */
export const ATLAS_OK_CONSENSUS = ["HEALTHY", "DEGRADED"];

/** `atlas` on GET /api/price. */
export interface AtlasStatus {
  /** The swap may run: the push feed is fresh and the Pull API consensus is HEALTHY or DEGRADED. */
  ok: boolean;
  /** Why not, in English (server wording). */
  reason?: string;
  /** Atlas BNB/USD push feed: the answer with 18 decimals (string) and when it was written on-chain. */
  bnbUsdE18?: string;
  bnbUsd?: number;
  updatedAt?: string;
  /** 2x the feed heartbeat: older answers are refused. */
  maxAgeSec: number;
  /** Pull API consensus for BNB/USD (feed 633). */
  consensus?: { score: number; status: string };
  fetchedAt: string;
}

/** amountOutMin = 99 % of the Atlas value of the BNB sent. */
export const SLIPPAGE_BPS = BigInt(100);
/** A pool quote more than 2 % away from Atlas is not trusted. */
export const MAX_DEVIATION_BPS = BigInt(200);
/** BSC mainnet is a capped pilot: one swap never buys more than 1 USDT (deposit 0.70 + rent 0.30 caps). */
export const MAINNET_MAX_OUT_TOKENS = 1;

const BPS = BigInt(10_000);
const E36 = BigInt(10) ** BigInt(36);

/** PancakeSwap V2 router on BSC mainnet; on testnet and anvil the AtlasSwapGuard deployment has the same functions. */
export const PANCAKE_V2_ROUTER_56: Address = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const WBNB_56: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
export const routerAbi = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

/** Router and path for BNB -> the escrow stablecoin; null when this chain has no swap (testnet guard not deployed). */
export function swapRoute(chainId: number, token: Address, guard: Address | undefined) {
  if (chainId === 56) return { router: PANCAKE_V2_ROUTER_56, path: [WBNB_56, token] as const, pancake: true };
  // The AtlasSwapGuard ignores path[0]: it only sells native BNB.
  return guard ? { router: guard, path: [zeroAddress, token] as const, pancake: false } : null;
}

/** Token units the Atlas price gives for `bnbWei` (18-decimal price, 1 token = 1 USD). */
export const atlasOut = (bnbWei: bigint, priceE18: bigint, decimals: number) => (bnbWei * priceE18 * BigInt(10) ** BigInt(decimals)) / E36;

export type SwapPlan =
  | { ok: true; bnbIn: bigint; atlasOut: bigint; amountOutMin: bigint }
  | { ok: false; why: "atlas" | "cap" };

/**
 * BNB to send so that amountOutMin (99 % of its Atlas value) still covers `need` token units. Fails closed: refuses
 * when Atlas refuses (stale feed, bad consensus) or the answer is older than 2x the heartbeat by now, and on BSC
 * mainnet above the 1 USDT pilot cap.
 */
export function planBnbSwap(need: bigint, decimals: number, atlas: AtlasStatus | undefined, chainId: number, nowMs = Date.now()): SwapPlan {
  // The server said ok up to ~30 s ago: the feed age is checked again against now.
  if (!atlas?.ok || !atlas.bnbUsdE18 || !atlas.updatedAt || nowMs - Date.parse(atlas.updatedAt) > atlas.maxAgeSec * 1000) return { ok: false, why: "atlas" };
  if (chainId === 56 && need > BigInt(MAINNET_MAX_OUT_TOKENS) * BigInt(10) ** BigInt(decimals)) return { ok: false, why: "cap" };
  const price = BigInt(atlas.bnbUsdE18);
  // +1 unit: both divisions round down, so amountOutMin lands at or above `need`.
  const num = (need + BigInt(1)) * BPS * E36;
  const den = (BPS - SLIPPAGE_BPS) * price * BigInt(10) ** BigInt(decimals);
  const bnbIn = (num + den - BigInt(1)) / den;
  const out = atlasOut(bnbIn, price, decimals);
  return { ok: true, bnbIn, atlasOut: out, amountOutMin: (out * (BPS - SLIPPAGE_BPS)) / BPS };
}

/** True when the pool (or guard) quote is within 2 % of the Atlas value. */
export const quoteTrusted = (poolOut: bigint, atlasValue: bigint) => {
  const diff = poolOut > atlasValue ? poolOut - atlasValue : atlasValue - poolOut;
  return atlasValue > BigInt(0) && diff * BPS <= atlasValue * MAX_DEVIATION_BPS;
};

/** The badge's numbers: "updated {age} s ago · consensus {score} {status}", the age as of the server's fetch. */
export function atlasBadge(a: AtlasStatus) {
  return {
    age: a.updatedAt ? Math.max(0, Math.round((Date.parse(a.fetchedAt) - Date.parse(a.updatedAt)) / 1000)) : null,
    score: a.consensus ? a.consensus.score.toFixed(2) : null,
    status: a.consensus?.status ?? null,
  };
}
