/** OpenAPI 3.1 document for /api/v1, generated from the action definitions (no hand-written paths). */
import { z } from "zod";
import { ACTIONS, toolDescription } from "./definitions";
import { SUPPORTED_CHAIN_IDS, TOKEN } from "./fields";
import { API_BASE, methodOf } from "./rest";

type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema>; required?: string[] };

/** The JSON Schema of an action's input, as a caller sends it (before transforms). */
export function inputJsonSchema(schema: z.ZodType): JsonSchema {
  const s = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12", unrepresentable: "any" }) as JsonSchema;
  delete s.$schema;
  return s;
}

const ERROR = {
  type: "object",
  required: ["error", "code"],
  properties: {
    error: { type: "string", description: "Plain-language reason, safe to show to a person." },
    code: {
      type: "string",
      enum: ["invalid_input", "unknown_action", "unsupported_chain", "not_found", "precondition_failed", "simulation_reverted", "rpc_unavailable", "method_not_allowed", "internal_error"],
    },
    details: { description: "Validation issues, or the decoded revert (step, function, errorName, args)." },
  },
};

const PREPARED = {
  type: "object",
  required: ["chainId", "from", "steps", "summary", "simulation", "unsigned"],
  properties: {
    chainId: { type: "integer", enum: [...SUPPORTED_CHAIN_IDS] },
    from: { type: "string", description: "The address that must sign every step." },
    steps: {
      type: "array",
      description: "Unsigned transactions; sign and send them in order.",
      items: {
        type: "object",
        required: ["to", "data", "value", "description"],
        properties: {
          to: { type: "string" },
          data: { type: "string", description: "ABI-encoded calldata (0x…)." },
          value: { type: "string", description: "Native value in wei, decimal string (always \"0\")." },
          description: { type: "string" },
          function: { type: "string", description: "Solidity signature, e.g. fund()." },
        },
      },
    },
    summary: { type: "string", description: "What signing these steps will do, in plain language." },
    simulation: { type: "object", properties: { method: { type: "string", enum: ["eth_simulateV1", "eth_call"] }, ok: { const: true }, note: { type: "string" } } },
    expected: { type: "object", description: "Values the simulation returned, e.g. `lease` for prepare_create_lease." },
    unsigned: { const: true },
  },
};

const str = { type: "string" };
/** GET /api/listings items (lib/listings.ts listingJson). */
const LISTING = {
  type: "object",
  required: ["slug", "name", "description", "location", "city", "area", "rentThb", "monthThb", "depositThb", "stage", "demo", "photos"],
  properties: {
    slug: { type: "string", description: "The listing's id on the website (/app/listings/<slug>), the iOS app and /api/stage/<slug>." },
    name: str,
    description: str,
    location: str,
    city: str,
    area: { type: ["string", "null"] },
    rentThb: { type: "number", description: "Rent per day, THB." },
    monthThb: { type: ["number", "null"], description: "Rent per month, THB, when the listing offers one." },
    depositThb: { type: "number", description: "Deposit, THB." },
    stage: { type: "boolean", description: "The live stage demo's item." },
    demo: { type: "boolean", description: "A made-up offer to try the rental with." },
    photos: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "width", "height", "alt", "credit"],
        properties: {
          url: { type: "string", description: "Absolute URL of the 1200 px JPEG." },
          width: { type: "integer" },
          height: { type: "integer" },
          alt: str,
          credit: {
            type: "object",
            required: ["title", "author", "license", "licenseUrl", "source", "changes"],
            properties: { title: str, author: str, license: str, licenseUrl: str, source: str, changes: str, note: str },
          },
        },
      },
    },
  },
};

const errors = {
  "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "404": { description: "Unknown action, or not a KeyEscrow rental", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "409": { description: "Wrong role or rental status", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "422": { description: "The transaction would revert (simulated); `error` says why", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "502": { description: "Chain node or price source unreachable", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

export function buildOpenApi(serverUrl?: string) {
  const paths: Record<string, unknown> = {};
  for (const a of ACTIONS) {
    const schema = inputJsonSchema(a.input);
    const method = methodOf(a).toLowerCase();
    const op: Record<string, unknown> = {
      operationId: a.name,
      summary: a.title,
      description: toolDescription(a),
      tags: [a.kind === "read" ? "Reads" : "Prepare (unsigned transactions)"],
      "x-roles": a.roles,
      ...(a.statuses ? { "x-statuses": a.statuses } : {}),
      responses: {
        "200": {
          description: a.kind === "read" ? "Result" : "Unsigned, simulated transactions",
          content: { "application/json": { schema: a.kind === "read" ? { type: "object" } : { $ref: "#/components/schemas/Prepared" } } },
        },
        ...errors,
      },
    };
    if (method === "get") {
      op.parameters = Object.entries(schema.properties ?? {}).map(([name, s]) => ({
        name,
        in: "query",
        required: schema.required?.includes(name) ?? false,
        description: s.description,
        schema: s,
      }));
    } else {
      op.requestBody = { required: true, content: { "application/json": { schema, example: a.example } } };
    }
    paths[`${API_BASE}/${a.name}`] = { [method]: op };
  }
  // The listing catalogue: no chain and no MCP tool, but the public read the website and the iOS app share.
  const listing = { content: { "application/json": { schema: { $ref: "#/components/schemas/Listing" } } } };
  paths["/api/listings"] = {
    get: {
      operationId: "listings",
      summary: "The listing catalogue",
      description: "Every listing (demo scooters and the stage item) with prices in THB and its photos, each with its Wikimedia Commons credit. Cached for 5 minutes.",
      tags: ["Reads"],
      responses: {
        "200": {
          description: "The catalogue",
          content: { "application/json": { schema: { type: "object", required: ["thbPerUsdt", "listings"], properties: { thbPerUsdt: { type: "number" }, listings: { type: "array", items: { $ref: "#/components/schemas/Listing" } } } } } },
        },
      },
    },
  };
  paths["/api/listings/{slug}"] = {
    get: {
      operationId: "listing",
      summary: "One listing of the catalogue",
      tags: ["Reads"],
      parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" }, description: "e.g. honda-click-125i" }],
      responses: { "200": { description: "The listing", ...listing }, "404": { description: "No such listing", content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } } },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "KeyEscrow rental actions",
      version: "1.0.0",
      description:
        "Scooter-rental deposit and rent escrow on BNB Chain. Reads return JSON; prepare_* return UNSIGNED, simulated " +
        "transactions for the caller's own wallet: this API never holds a key and never sends a transaction. The same actions " +
        `are MCP tools on the KeyEscrow Inspector agent (docs/AGENT.md). Amounts: ${TOKEN.symbol} has ${TOKEN.decimals} decimals; \`units\` fields are base units.`,
    },
    ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
    paths,
    components: { schemas: { Error: ERROR, Prepared: PREPARED, Listing: LISTING } },
  };
}
