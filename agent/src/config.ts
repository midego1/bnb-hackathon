import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configFromEnv, type AgentConfig, type AgentDeployment } from "./identity.ts";

export const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = path.resolve(AGENT_DIR, "..");

export { AGENT_DESCRIPTION, AGENT_NAME, AGENT_VERSION, REPO_URL, configFromEnv, type AgentConfig, type AgentDeployment } from "./identity.ts";

type Env = Record<string, string | undefined>;

export function readDeployment(file: string): AgentDeployment | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as AgentDeployment;
}

export function deploymentFile(env: Env = process.env): string {
  return env.INSPECTOR_DEPLOYMENT
    ? path.resolve(env.INSPECTOR_DEPLOYMENT)
    : path.join(AGENT_DIR, "deployments", `${env.INSPECTOR_CHAIN_ID || "97"}.json`);
}

/**
 * Env (all server-side; see docs/AGENT.md):
 *   AGENT_HOST / AGENT_PORT     listen address (default 127.0.0.1:8790)
 *   AGENT_PUBLIC_URL            base URL in the agent card / registration file (default http://<host>:<port>)
 *   INSPECTOR_PRIVATE_KEY       report-signing key (its address is the `reportSigner` metadata on the ERC-8004 identity)
 *   INSPECTOR_AGENT_ID          ERC-8004 agent id; INSPECTOR_AGENT_REGISTRY = eip155:<chainId>:<registry>
 *   INSPECTOR_DEPLOYMENT        registration record to read the ids from when the two above are unset
 *                               (default agent/deployments/97.json, written by `pnpm agent:register`)
 *   VISION_LLM_PROVIDER / ANTHROPIC_API_KEY / VISION_LLM_MODEL   same as the web app; mock without a key
 *   EVIDENCE_DIR                local evidence store for photo hashes (default web/.evidence, shared with the web app)
 */
export function loadConfig(env: Env = process.env): AgentConfig {
  return configFromEnv(env, readDeployment(deploymentFile(env)));
}
