/**
 * The one seam between the agent and the web app: the return inspection is the exact code behind
 * POST /api/settlement (web/lib/server/settlement), imported from source rather than copied, so the agent and the
 * product can never disagree about a proposal or its reportHash.
 *
 * Each name is imported from the module that defines it: web/ is not an ES module package, so tsx loads its files
 * as CommonJS, and Node cannot see names that index.ts only re-exports with `export *`.
 */
export { proposeSettlement, type SettlementResult } from "../../web/lib/server/settlement/index.ts";
export {
  INSPECTOR_NAME,
  InspectorConfigError,
  inspectorFromEnv,
  inspectorLabel,
  inspectorSignerFromKey,
  verifyInspectorReport,
  type InspectorIdentity,
  type InspectorSigner,
} from "../../web/lib/server/settlement/inspector.ts";
export { SettlementRequestSchema, type SettlementRequest } from "../../web/lib/server/settlement/schema.ts";
export { visionProviderFromEnv, type VisionProvider } from "../../web/lib/server/settlement/vision.ts";
export type { EvidenceStore } from "../../web/lib/server/evidence/types.ts";

// The rental actions (web/lib/actions): one definition per action, served here as MCP tools and A2A skills.
export { ACTIONS, findAction, toolDescription, type Action } from "../../web/lib/actions/definitions.ts";
export { TOKEN } from "../../web/lib/actions/fields.ts";
export { executeAction, errorBody, jsonSafe, parseInput, runAction } from "../../web/lib/actions/run.ts";
export { ActionError, type ActionHost } from "../../web/lib/actions/context.ts";
export { PriceService } from "../../web/lib/server/price/index.ts";
