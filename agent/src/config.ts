import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectorSignerFromKey, type InspectorSigner } from "./shared.ts";

export const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = path.resolve(AGENT_DIR, "..");

export const AGENT_NAME = "KeyEscrow Inspector";
export const AGENT_VERSION = "0.1.0";
export const AGENT_DESCRIPTION =
  "Neutral move-out inspector for KeyEscrow rental-deposit escrows on BNB Chain. Compares check-in and check-out " +
  "photos and proposes how the deposit is split (tenantRefund + landlordClaim = deposit), with reasons, a confidence " +
  "score and a reportHash that the tenant or landlord passes to RentalEscrow.propose(). Every report is signed by " +
  "this agent's ERC-8004 identity.";
export const REPO_URL = "https://github.com/midego1/bnb-hackathon";

/** Shape of agent/deployments/<chainId>.json, written by `pnpm agent:register`. */
export interface AgentDeployment {
  chainId: number;
  network: string;
  agentId: string;
  identityRegistry: `0x${string}`;
  agentRegistry: string;
  owner: `0x${string}`;
  reportSigner: `0x${string}`;
  agentURI: string;
  publicUrl: string;
  registerTx: `0x${string}`;
  registeredAt: string;
  sdk: string;
}

export interface AgentConfig {
  host: string;
  port: number;
  /** Base URL other agents reach this one on (used in the agent card and the ERC-8004 registration file). */
  publicUrl: string;
  /** Report signer + ERC-8004 identity; null -> reports are unsigned (still valid, just not attributable). */
  inspector: InspectorSigner | null;
  /** Where the ERC-8004 ids came from, for logs. */
  identitySource: "env" | "deployment" | "none";
  deployment: AgentDeployment | null;
}

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
  const host = env.AGENT_HOST || "127.0.0.1";
  const port = Number(env.AGENT_PORT || "8790");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`AGENT_PORT must be a TCP port, got ${env.AGENT_PORT}`);
  const publicUrl = (env.AGENT_PUBLIC_URL || `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`).replace(/\/+$/, "");

  const deployment = readDeployment(deploymentFile(env));
  const key = env.INSPECTOR_PRIVATE_KEY?.trim();
  let inspector: InspectorSigner | null = null;
  let identitySource: AgentConfig["identitySource"] = "none";
  if (key) {
    let agentId = env.INSPECTOR_AGENT_ID?.trim() || undefined;
    let agentRegistry = env.INSPECTOR_AGENT_REGISTRY?.trim() || undefined;
    if (agentId !== undefined || agentRegistry !== undefined) identitySource = "env";
    else if (deployment) {
      agentId = deployment.agentId;
      agentRegistry = deployment.agentRegistry;
      identitySource = "deployment";
    }
    inspector = inspectorSignerFromKey(key as `0x${string}`, { agentId, agentRegistry, name: AGENT_NAME });
    if (identitySource === "deployment" && deployment!.reportSigner.toLowerCase() !== inspector.identity.address.toLowerCase()) {
      throw new Error(
        `INSPECTOR_PRIVATE_KEY signs as ${inspector.identity.address}, but ERC-8004 agent #${deployment!.agentId} ` +
          `lists reportSigner ${deployment!.reportSigner}. Use the registered key or re-register.`,
      );
    }
  }
  return { host, port, publicUrl, inspector, identitySource, deployment };
}
