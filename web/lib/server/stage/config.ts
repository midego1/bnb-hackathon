import type { Env } from "../env";

/**
 * Is the live stage demo on, and its limits. No viem here: the stage and listing pages import this, and a page that
 * pulls in viem gets its own copy of it in the Cloudflare Worker.
 */

export type StageChainId = 97 | 31337 | 56;

export type StageConfig = {
  chainId: StageChainId;
  /** When set, the presenter buttons (accept, reset) need it. */
  presenterCode?: string;
  /** Phones the server may fund per hour, and rentals it may create per hour. */
  dripsPerHour: number;
  leasesPerHour: number;
  /** BSC mainnet only: phones the server may fund per 24 hours (real money). */
  dripsPerDay?: number;
};

const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d;
};

/**
 * On only with STAGE_DEMO=1 on a BSC testnet (97), local anvil (31337) or BSC mainnet (56) build. Anything else:
 * undefined, and the stage API answers 404. On 97 the wallets come from the live testnet demo's key source
 * (DEMO_TESTNET_*), on 56 from DEMO_MAINNET_*, see index.ts. Mainnet hands out real money, so its limits are tighter
 * and capped lower: 10 phones an hour and 30 a day by default.
 */
export function stageConfig(env: Env): StageConfig | undefined {
  if (env.STAGE_DEMO !== "1") return undefined;
  const chainId = Number(env.NEXT_PUBLIC_CHAIN_ID || 31337);
  if (chainId === 56) {
    return {
      chainId,
      presenterCode: env.STAGE_PRESENTER_CODE || undefined,
      dripsPerHour: int(env.STAGE_DRIPS_PER_HOUR, 10, 1, 30),
      dripsPerDay: int(env.STAGE_DRIPS_PER_DAY, 30, 1, 100),
      leasesPerHour: int(env.STAGE_LEASES_PER_HOUR, 10, 1, 30),
    };
  }
  if (chainId !== 97 && chainId !== 31337) return undefined;
  return {
    chainId,
    presenterCode: env.STAGE_PRESENTER_CODE || undefined,
    dripsPerHour: int(env.STAGE_DRIPS_PER_HOUR, 30, 1, 200),
    leasesPerHour: int(env.STAGE_LEASES_PER_HOUR, 20, 1, 100),
  };
}

