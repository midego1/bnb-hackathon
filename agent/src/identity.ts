import { inspectorSignerFromKey, type InspectorSigner } from "./shared.ts";

/**
 * The agent's identity and config, free of Node APIs so the same code runs under Node (src/main.ts, express) and on
 * Cloudflare Workers (src/worker.ts). File access (reading agent/deployments/<chainId>.json) lives in config.ts.
 */

export const AGENT_NAME = "KeyEscrow Inspector";
export const AGENT_VERSION = "0.1.0";
export const AGENT_DESCRIPTION =
  "Neutral return inspector for KeyEscrow scooter-rental deposit escrows on BNB Chain. Compares pickup and return " +
  "photos of the scooter and proposes how the deposit is split (tenantRefund = renter, landlordClaim = owner), with reasons, a " +
  "confidence score and a reportHash that the renter or owner passes to RentalEscrow.propose(). Every report is signed by " +
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

/**
 * Build the config from env plus the registration record (null when there is none). Pure: no file or network access.
 * See loadConfig in config.ts for the env variables.
 */
export function configFromEnv(env: Env, deployment: AgentDeployment | null): AgentConfig {
  const host = env.AGENT_HOST || "127.0.0.1";
  const port = Number(env.AGENT_PORT || "8790");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`AGENT_PORT must be a TCP port, got ${env.AGENT_PORT}`);
  const publicUrl = (env.AGENT_PUBLIC_URL || `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`).replace(/\/+$/, "");

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
