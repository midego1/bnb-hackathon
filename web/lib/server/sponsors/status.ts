import type { Env } from "../env";
import { atlasConfigured } from "../price";
import { cmcApiKey } from "./cmc";
import { cournotConfig } from "./cournot";
import { livingBrainConfig } from "./livingbrain";
import { recentSponsorCalls, type SponsorCall } from "./log";

export interface IntegrationStatus {
  id: SponsorCall["sponsor"];
  name: string;
  state: "live" | "not-configured" | "blocked" | "off";
  detail: string;
  env: string[];
  calls: SponsorCall[];
}

/** Configuration and recent calls per sponsor integration, for /integrations. Never exposes values. */
export async function integrationStatus(env: Env = process.env): Promise<IntegrationStatus[]> {
  let cournotLive = false;
  try {
    cournotLive = cournotConfig(env).live;
  } catch {
    cournotLive = false;
  }
  const lb = livingBrainConfig(env);
  return [
    {
      id: "cmc",
      name: "CoinMarketCap Pro API",
      state: cmcApiKey(env) ? "live" : "not-configured",
      detail: cmcApiKey(env)
        ? "Quotes (USD + THB) drive the deposit buffer and THB display. Server-side only, cached ~1-2 min."
        : "No CMC_API_KEY on the server: THB display uses labelled demo rates and the risk buffer shows 'not configured'.",
      env: ["CMC_API_KEY", "RISK_CACHE_TTL_SECONDS", "PRICE_CACHE_TTL_SECONDS"],
      calls: await recentSponsorCalls("cmc", 25, env),
    },
    {
      id: "cournot",
      name: "Cournot Intelligence Oracle",
      state: cournotLive ? "live" : "off",
      detail: cournotLive
        ? "Live calls allowed (COURNOT_LIVE=1). Each probability call uses one of 3 free calls per IP; answers are stored and reused."
        : "Live calls off. Stored answers from earlier live calls are still shown and used. Set COURNOT_LIVE=1 to allow a call.",
      env: ["COURNOT_LIVE", "COURNOT_API_BASE", "COURNOT_API_KEY", "COURNOT_MAX_LIVE_CALLS"],
      calls: await recentSponsorCalls("cournot", 25, env),
    },
    {
      id: "atlas",
      name: "Atlas push oracle (BSC)",
      state: atlasConfigured(env) ? "live" : "blocked",
      detail: atlasConfigured(env)
        ? "latestRoundData() with a staleness check (ATLAS_MAX_AGE_SECONDS) is the first price source for THB/USD display."
        : "No Atlas feed addresses for BSC testnet are published; set them once Atlas provides them.",
      env: ["ATLAS_RPC_URL", "ATLAS_FEED_BNB_USD", "ATLAS_FEED_USDT_USD", "ATLAS_FEED_USD_THB", "ATLAS_MAX_AGE_SECONDS"],
      calls: await recentSponsorCalls("atlas", 25, env),
    },
    {
      id: "livingbrain",
      name: "Living Brain (ChatAndBuild)",
      state: lb.configured ? "live" : "not-configured",
      detail: lb.configured
        ? "The AI inspector searches the scooter's history before judging. The web app captures the new inspection only for a rental it verified on-chain (20 an hour per IP); the agent only reads."
        : `Missing ${lb.missing.join(", ")}: the inspector uses a local memory file instead (web/.sponsor-logs/inspections.jsonl).`,
      env: ["LIVING_BRAIN_API_KEY", "LIVING_BRAIN_SUBJECT_ID", "LIVING_BRAIN_BRAIN_ID", "LIVING_BRAIN_BASE_URL"],
      calls: await recentSponsorCalls("livingbrain", 25, env),
    },
  ];
}
