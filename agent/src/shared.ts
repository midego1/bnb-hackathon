/**
 * The one seam between the agent and the web app: the return inspection is the exact code behind
 * POST /api/settlement (web/lib/server/settlement), imported from source rather than copied, so the agent and the
 * product can never disagree about a proposal or its reportHash.
 *
 * Each name is imported from the module that defines it: web/ is not an ES module package, so tsx loads its files
 * as CommonJS, and Node cannot see names that index.ts only re-exports with `export *`.
 */
export { PhotoResolutionError, proposeSettlement, type SettlementResult } from "../../web/lib/server/settlement/index.ts";
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
export { ProposalRepairError, SettlementRequestSchema, type SettlementRequest } from "../../web/lib/server/settlement/schema.ts";
export { visionProviderFromEnv, VisionProviderError, type VisionProvider } from "../../web/lib/server/settlement/vision.ts";
export type { EvidenceStore } from "../../web/lib/server/evidence/types.ts";
