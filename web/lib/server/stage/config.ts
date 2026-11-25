import type { Env } from "../env";

/**
 * Is the live stage demo on, and its limits. No viem here: the stage and listing pages import this, and a page that
 * pulls in viem gets its own copy of it in the Cloudflare Worker.
 */

export type StageChainId = 97 | 31337;

export type StageConfig = {
  chainId: StageChainId;
  /** When set, the presenter buttons (accept, reset) need it. */
  presenterCode?: string;
  /** Phones the server may fund per hour, and rentals it may create per hour. */
  dripsPerHour: number;
  leasesPerHour: number;
};

const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d;
};

/**
 * On only with STAGE_DEMO=1 on a BSC testnet (97) or local anvil (31337) build. Anything else: undefined, and the stage
 * API answers 404. On 97 the wallets come from the live testnet demo's key source (DEMO_TESTNET_*), see index.ts.
 */
export function stageConfig(env: Env): StageConfig | undefined {
  if (env.STAGE_DEMO !== "1") return undefined;
  const chainId = Number(env.NEXT_PUBLIC_CHAIN_ID || 31337);
  if (chainId !== 97 && chainId !== 31337) return undefined;
  return {
    chainId,
    presenterCode: env.STAGE_PRESENTER_CODE || undefined,
    dripsPerHour: int(env.STAGE_DRIPS_PER_HOUR, 30, 1, 200),
    leasesPerHour: int(env.STAGE_LEASES_PER_HOUR, 20, 1, 100),
  };
}

