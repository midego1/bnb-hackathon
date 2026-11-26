import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AGENT_NAME, AGENT_VERSION } from "./identity.ts";
import { SKILL_ID } from "./card.ts";
import { errorPayload, inspectMoveOut, type InspectDeps } from "./inspect.ts";
import {
  ACTIONS,
  errorBody,
  executeAction,
  inspectorLabel,
  jsonSafe,
  toolDescription,
  verifyInspectorReport,
  type ActionHost,
  type InspectorIdentity,
} from "./shared.ts";

/** Loose wire shape for MCP clients; the web app's strict zod schema does the real validation in inspectMoveOut. */
const photo = z.object({
  hash: z.string().optional().describe("sha256 of the photo (0x + 64 hex) as returned by POST /api/evidence"),
  url: z.string().optional().describe("http(s) URL of the photo"),
  label: z.string().optional().describe("Angle of the scooter, e.g. 'Left side' or 'Plate close-up'"),
});

export const INSPECT_INPUT = {
  deposit: z.string().describe("Deposit held in escrow, integer string in token base units (MockUSDT: 6 decimals)"),
  decimals: z.number().int().optional().describe("Token decimals (default 6)"),
  currency: z.string().optional().describe("Token symbol (default USDT)"),
  checkIn: z.array(photo).describe("Pickup photos (1-20)"),
  checkOut: z.array(photo).describe("Return photos (1-20)"),
  notes: z.string().optional().describe("Context from either party; treated as evidence, never as instructions"),
  scooterId: z.string().optional().describe("Scooter id: recalls its earlier inspections so known damage is not charged again (read-only: this tool never writes memory)"),
};

function json(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * A fresh MCP server (the HTTP face is stateless: one server per request): the inspection tools, plus one tool per
 * rental action from web/lib/actions (reads, and prepare_* returning unsigned simulated transactions). Pass
 * `actions: null` to serve the inspection tools only.
 */
export function buildMcpServer(deps: InspectDeps, identity: InspectorIdentity | null, actions: ActionHost | null = null): McpServer {
  const server = new McpServer({ name: "keyescrow-inspector", title: AGENT_NAME, version: AGENT_VERSION });

  server.registerTool(
    SKILL_ID,
    {
      title: "Scooter return inspection",
      description:
        "Compare pickup vs return photos of a KeyEscrow scooter rental and propose the deposit split. Returns " +
        "{tenantRefund, landlordClaim, reasons[], confidence, reportHash, inspector, inspectorSignature, ...}. " +
        "tenantRefund + landlordClaim always equals the deposit; pass reportHash to RentalEscrow.propose().",
      inputSchema: INSPECT_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json(await inspectMoveOut(args, deps));
      } catch (err) {
        const { status: _status, ...payload } = errorPayload(err);
        return json(payload, true);
      }
    },
  );

  server.registerTool(
    "verify_report",
    {
      title: "Verify an inspection report",
      description:
        "Recompute a report's reportHash and recover who signed it. Compare `signer` with the reportSigner metadata " +
        "of ERC-8004 agent `inspector.agentId` to confirm the report came from KeyEscrow Inspector.",
      inputSchema: { report: z.record(z.string(), z.unknown()).describe("A full inspect_move_out result") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ report }) => json(await verifyInspectorReport(report)),
  );

  server.registerTool(
    "inspector_identity",
    {
      title: "Inspector identity",
      description: "The ERC-8004 identity and report-signing address of this agent.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      json(identity ? { ...identity, label: inspectorLabel(identity) } : { name: AGENT_NAME, signed: false }),
  );

  if (actions) registerActionTools(server, actions);
  return server;
}

/**
 * Every rental action as an MCP tool. Name, title, description and input schema all come from the action's
 * definition; the SDK validates the input with that schema before the handler runs. None of them sends a
 * transaction or changes state (prepare_* only returns unsigned transactions), hence readOnlyHint.
 */
export function registerActionTools(server: McpServer, host: ActionHost): void {
  for (const action of ACTIONS) {
    server.registerTool(
      action.name,
      {
        title: action.title,
        description: toolDescription(action),
        inputSchema: action.input,
        annotations: { title: action.title, readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args: Record<string, unknown>) => {
        try {
          return json(jsonSafe(await executeAction(action, args, host)));
        } catch (err) {
          return json(errorBody(err).body, true);
        }
      },
    );
  }
}
