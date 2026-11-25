import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import { AgentEndpoint, AgentURIGenerator } from "@bnbagent/sdk/erc8004";
import { AGENT_DESCRIPTION, AGENT_NAME, AGENT_VERSION, REPO_URL } from "./config.ts";
import type { InspectorIdentity } from "./shared.ts";

export const SKILL_ID = "inspect_move_out";
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const INSPECT_SKILL: AgentSkill = {
  id: SKILL_ID,
  name: "Move-out inspection",
  description:
    "Compare check-in vs check-out photos of a rental and propose the deposit split. Send one A2A data part with " +
    '{"deposit": "<base units>", "decimals": 6, "currency": "USDT", "checkIn": [{"hash"|"url", "label"?}], ' +
    '"checkOut": [...], "notes"?: "..."} (an optional "skill": "inspect_move_out" key is ignored). Returns ' +
    "{tenantRefund, landlordClaim, reasons[], confidence, reportHash, inspector, inspectorSignature, ...}; " +
    "tenantRefund + landlordClaim always equals the deposit. Pass reportHash to RentalEscrow.propose().",
  tags: ["keyescrow", "rental", "deposit", "inspection", "escrow", "bnb-chain", "erc-8004"],
  examples: [
    '{"deposit":"500000000","checkIn":[{"hash":"0xd36a…4f2f","label":"Living room"}],"checkOut":[{"hash":"0x34be…3c72","label":"Living room"}]}',
  ],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

/** The A2A agent card served at /.well-known/agent-card.json. */
export function buildAgentCard(publicUrl: string, identity: InspectorIdentity | null): AgentCard {
  return {
    name: AGENT_NAME,
    description:
      AGENT_DESCRIPTION +
      (identity?.agentId !== undefined ? ` ERC-8004 agent #${identity.agentId} (${identity.agentRegistry}).` : ""),
    url: `${publicUrl}/a2a`,
    version: AGENT_VERSION,
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    provider: { organization: "KeyEscrow", url: REPO_URL },
    documentationUrl: `${REPO_URL}/blob/main/docs/AGENT.md`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [INSPECT_SKILL],
  };
}

export function agentEndpoints(publicUrl: string): AgentEndpoint[] {
  return [
    AgentEndpoint.a2a(publicUrl, { version: "0.3.0", capabilities: [SKILL_ID] }),
    AgentEndpoint.mcp(`${publicUrl}/mcp`, { version: MCP_PROTOCOL_VERSION, capabilities: [SKILL_ID] }),
  ];
}

/**
 * The ERC-8004 registration file (the JSON behind the agent's tokenURI), built with the BNB Agent SDK so it matches
 * what `ERC8004Agent.registerAgent` publishes. `registrations` is filled once the agent id is known.
 */
export function buildRegistrationFile(
  publicUrl: string,
  ids: { agentId?: string | number | null; identityRegistry?: string | null; chainId?: number | null } = {},
): Record<string, unknown> {
  return AgentURIGenerator.generateRegistrationFile({
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    endpoints: agentEndpoints(publicUrl),
    agentId: ids.agentId === undefined || ids.agentId === null ? null : Number(ids.agentId),
    identityRegistry: ids.identityRegistry ?? null,
    chainId: ids.chainId ?? null,
  });
}

/** Split `eip155:<chainId>:<address>` into its parts. */
export function parseAgentRegistry(ref: string | undefined): { chainId: number; identityRegistry: string } | null {
  const m = ref ? /^eip155:(\d+):(0x[0-9a-fA-F]{40})$/.exec(ref) : null;
  return m ? { chainId: Number(m[1]), identityRegistry: m[2] } : null;
}
