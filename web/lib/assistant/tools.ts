/**
 * Ask AI's tools, generated from the rental action registry (lib/actions/definitions.ts): Ask AI is its third
 * consumer, after /api/v1 and the MCP/A2A agent. Reads run at once; prepare_* never run on the model's say-so: the
 * engine prepares and simulates them, then the person approves the exact steps and signs them with their own wallet.
 *
 * The model never chooses who acts or on which chain: `from`, `viewer`, `chainId` (and list_leases' default `party`)
 * are filled in by the server from the connected wallet, so they are not in the schemas the model sees.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ACTIONS, toolDescription, type Action } from "../actions/definitions";
import { inputJsonSchema } from "../actions/openapi";

/** Inputs the server sets itself. */
export const SERVER_FIELDS = ["from", "viewer", "chainId", "limit"] as const;

export type ToolKind = "read" | "prepare" | "page" | "inspect";

export type AssistantTool = { name: string; kind: ToolKind; title: string; action?: Action; spec: Anthropic.Tool };

type Schema = { type?: string; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

function modelSchema(action: Action): Anthropic.Tool.InputSchema {
  const s = inputJsonSchema(action.input) as Schema;
  const properties = { ...(s.properties ?? {}) };
  for (const f of SERVER_FIELDS) delete properties[f];
  let required = (s.required ?? []).filter((r) => !(SERVER_FIELDS as readonly string[]).includes(r));
  // list_leases: the connected wallet is the default party.
  if (action.name === "list_leases") required = required.filter((r) => r !== "party");
  return { ...s, type: "object", properties, ...(required.length ? { required } : { required: undefined }) } as Anthropic.Tool.InputSchema;
}

const ASSISTANT_NOTE: Record<string, string> = {
  list_leases: " `party` defaults to the connected wallet. A card with the exact totals is shown to the person; quote its TOTALS line, never count rows yourself.",
  get_lease: " A rental card is shown to the person; do not repeat every field.",
  explain_status: " The answer is phrased for the connected wallet. A rental card is shown to the person too.",
};

const PREPARE_NOTE =
  " In Ask AI: calling this does NOT change anything. KeyEscrow prepares and simulates the steps, shows the person an approval " +
  "card and waits; the person approves and signs with their own wallet, or declines. The tool result tells you which happened. " +
  "`from` is always the connected wallet.";

const OPEN_PAGE: AssistantTool = {
  name: "open_page",
  kind: "page",
  title: "Open a page",
  spec: {
    name: "open_page",
    description:
      "Open a page of the KeyEscrow app for the person (when they ask to go somewhere, or after an answer that is about another page). " +
      "Allowed: / (home), /tenant (renter), /landlord (fleet owner), /arbiter (dispute desk), /backoffice, /shareholders, " +
      "/how-it-works, /developers, /integrations, /demo, and /lease/<rental address>. Nothing else.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "An allowed in-app path, e.g. /arbiter or /lease/0x…" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

const INSPECT: AssistantTool = {
  name: "inspect_return",
  kind: "inspect",
  title: "Run the AI return inspection",
  spec: {
    name: "inspect_return",
    description:
      "Run KeyEscrow's AI return inspection for a rental: it compares the pickup and return photos anchored on the rental and " +
      "proposes how to split the deposit (refund to the renter, claim for the owner, reasons, confidence). Read-only: nothing is " +
      "proposed on-chain. To propose the split, pass the whole result as `inspection` to prepare_propose_settlement.",
    input_schema: {
      type: "object",
      properties: { lease: { type: "string", description: "Rental (escrow) address, 0x…" } },
      required: ["lease"],
      additionalProperties: false,
    },
  },
};

/** Stable order (registry order, then UI tools), so the cached prompt prefix never changes between requests. */
export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  ...ACTIONS.map(
    (a): AssistantTool => ({
      name: a.name,
      kind: a.kind,
      title: a.title,
      action: a,
      spec: {
        name: a.name,
        description: toolDescription(a) + (a.kind === "prepare" ? PREPARE_NOTE : (ASSISTANT_NOTE[a.name] ?? "")),
        input_schema: modelSchema(a),
      },
    }),
  ),
  INSPECT,
  OPEN_PAGE,
];

export function findTool(name: string): AssistantTool | undefined {
  return ASSISTANT_TOOLS.find((t) => t.name === name);
}

/** Tool specs for the API, with a cache breakpoint on the last one (tools + system prompt are the cached prefix). */
export function toolSpecs(): Anthropic.Tool[] {
  return ASSISTANT_TOOLS.map((t, i) => (i === ASSISTANT_TOOLS.length - 1 ? { ...t.spec, cache_control: { type: "ephemeral" } } : t.spec));
}

/** Step labels for the panel ("Reading the rental…" while running, "Read the rental" when done). */
export function stepLabel(t: AssistantTool, done: boolean): string {
  const map: Record<string, [string, string]> = {
    get_lease: ["Reading the rental…", "Read the rental"],
    list_leases: ["Looking up rentals…", "Looked up rentals"],
    explain_status: ["Checking where the deposit is…", "Checked the deposit"],
    quote: ["Converting the amount…", "Converted the amount"],
    inspect_return: ["Comparing pickup and return photos…", "Ran the AI inspection"],
    open_page: ["Opening a page…", "Opened a page"],
  };
  const m = map[t.name];
  if (m) return done ? m[1] : m[0];
  return done ? `Prepared: ${t.title}` : `Preparing: ${t.title}…`;
}
