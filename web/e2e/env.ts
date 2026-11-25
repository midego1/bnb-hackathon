/**
 * The complete environment for the e2e web server, so nothing from web/.env.local, web/.env or the shell can leak
 * into the build (an owner's .env.local pointing NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS at another anvil would
 * otherwise be baked into the bundle). Next's env loader only fills variables that are *undefined* in
 * process.env, so every variable the app reads is set here, to an explicit value or to "".
 *
 * Playwright starts the webServer before globalSetup, so the build cannot wait for the deploy. Instead it gets the
 * deterministic fresh-anvil deployment (contracts/deployments/31337.example.json), and e2e/global-setup.ts
 * fails the run unless the deployment it actually creates matches these exact addresses.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const E2E_RPC_PORT = Number(process.env.E2E_RPC_PORT ?? 28546);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3150);
export const E2E_RPC_URL = `http://127.0.0.1:${E2E_RPC_PORT}`;

const example = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../contracts/deployments/31337.example.json"), "utf8"),
) as { escrowFactory: string; token: string; defaultArbiter: string; fleetVault: string };

/** Addresses the e2e app is built with; global setup asserts the fresh deploy lands on exactly these. */
export const E2E_DEPLOYMENT = {
  escrowFactory: example.escrowFactory,
  token: example.token,
  defaultArbiter: example.defaultArbiter,
  fleetVault: example.fleetVault,
} as const;

export const E2E_WEB_ENV: Record<string, string> = {
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_TELEMETRY_DISABLED: "1",

  // --- Every NEXT_PUBLIC_* the app reads (grep -rho 'NEXT_PUBLIC_[A-Z_]*' app components lib) ---
  NEXT_PUBLIC_CHAIN_ID: "31337",
  NEXT_PUBLIC_RPC_URL: E2E_RPC_URL,
  NEXT_PUBLIC_ANVIL_RPC_URL: E2E_RPC_URL, // legacy alias, same value so neither can point elsewhere
  NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: E2E_DEPLOYMENT.escrowFactory,
  NEXT_PUBLIC_MOCK_USDT_ADDRESS: E2E_DEPLOYMENT.token,
  NEXT_PUBLIC_DISPUTE_DESK_ADDRESS: E2E_DEPLOYMENT.defaultArbiter,
  NEXT_PUBLIC_FLEET_VAULT_ADDRESS: E2E_DEPLOYMENT.fleetVault,
  NEXT_PUBLIC_DEV_ACCOUNTS: "1",
  NEXT_PUBLIC_DEMO_TESTNET: "0",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
  NEXT_PUBLIC_BSC_TESTNET_RPC_URL: "",
  NEXT_PUBLIC_OPBNB_TESTNET_RPC_URL: "",

  // --- Server-side: offline and deterministic. Blank every key so a local one can never call a paid API. ---
  VISION_LLM_PROVIDER: "mock",
  ANTHROPIC_API_KEY: "",
  VISION_LLM_MODEL: "",
  CMC_API_KEY: "",
  CMC_PRO_API_KEY: "",
  ATLAS_RPC_URL: "",
  ATLAS_FEED_USDT_USD: "",
  ATLAS_FEED_BNB_USD: "",
  ATLAS_FEED_USD_THB: "",
  PRICE_CACHE_TTL_SECONDS: "",
  GREENFIELD_RPC_URL: "",
  GREENFIELD_CHAIN_ID: "",
  GREENFIELD_BUCKET: "",
  GREENFIELD_PRIVATE_KEY: "",
  GREENFIELD_SP_ENDPOINT: "",
  EVIDENCE_DIR: "test-results/e2e-evidence",
  EVIDENCE_MAX_BYTES: "",
  // Inspector reports stay unsigned in e2e: a local INSPECTOR_PRIVATE_KEY must not leak into the run.
  INSPECTOR_PRIVATE_KEY: "",
  INSPECTOR_AGENT_ID: "",
  INSPECTOR_AGENT_REGISTRY: "",
  // The live BSC testnet demo runner never runs in e2e (its routes answer 404).
  DEMO_TESTNET_RUNNER: "",
  DEMO_TESTNET_SECRETS_DIR: "",
  DEMO_TESTNET_ENV_FILE: "",
  DEMO_TESTNET_RPC_URL: "",
  // Sponsor integrations: never live in e2e (no CMC credits, no Cournot free calls, no Living Brain).
  CMC_API_BASE: "",
  RISK_CACHE_TTL_SECONDS: "",
  COURNOT_LIVE: "",
  COURNOT_API_BASE: "",
  COURNOT_API_KEY: "",
  COURNOT_MAX_LIVE_CALLS: "",
  LIVING_BRAIN_API_KEY: "",
  LIVING_BRAIN_SUBJECT_ID: "",
  LIVING_BRAIN_BRAIN_ID: "",
  LIVING_BRAIN_BASE_URL: "",
  ATLAS_MAX_AGE_SECONDS: "",
  SPONSOR_LOG_DIR: "test-results/e2e-sponsor-logs",
};
