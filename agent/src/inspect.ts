import path from "node:path";
import type { InspectionMemory } from "../../web/lib/server/sponsors/livingbrain.ts";
import { REPO_DIR } from "./config.ts";
import {
  PhotoResolutionError,
  ProposalRepairError,
  proposeSettlement,
  SettlementRequestSchema,
  visionProviderFromEnv,
  VisionProviderError,
  type EvidenceStore,
  type InspectorSigner,
  type SettlementResult,
  type VisionProvider,
} from "./shared.ts";

/** Bad input from the caller (maps to A2A/MCP error results and HTTP 400). */
export class InspectionInputError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "InspectionInputError";
  }
}

/** The model or provider failed (HTTP 502). */
export class InspectionUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionUpstreamError";
  }
}

export interface InspectDeps {
  inspector: InspectorSigner | null;
  /** Defaults to visionProviderFromEnv(): Anthropic with ANTHROPIC_API_KEY, otherwise the deterministic mock. */
  provider?: VisionProvider | null;
  store?: EvidenceStore;
  /** Per-scooter inspection memory; defaults to Living Brain (LIVING_BRAIN_*) or the web app's local stand-in. */
  memory?: InspectionMemory | null;
  now?: Date;
}

/** Living Brain when configured, else web/.sponsor-logs/inspections.jsonl (shared with the web app). */
async function inspectionMemory(): Promise<InspectionMemory> {
  process.env.SPONSOR_LOG_DIR ??= path.join(REPO_DIR, "web", ".sponsor-logs");
  const m = await import("../../web/lib/server/sponsors/livingbrain.ts");
  return m.inspectionMemoryFromEnv();
}

let storePromise: Promise<EvidenceStore> | null = null;

/** The web app's evidence store (Greenfield or local disk). Loaded lazily: mock mode never touches it. */
function evidenceStore(): Promise<EvidenceStore> {
  // Share the web app's local fallback directory unless told otherwise.
  process.env.EVIDENCE_DIR ??= path.join(REPO_DIR, "web", ".evidence");
  storePromise ??= import("../../web/lib/server/evidence/index.ts").then((m) => m.getEvidenceStore());
  return storePromise;
}

/**
 * The `inspect_move_out` skill: validate the request with the web app's schema, run the same inspection as
 * POST /api/settlement, and sign the reportHash with the inspector's ERC-8004 identity.
 */
export async function inspectMoveOut(input: unknown, deps: InspectDeps): Promise<SettlementResult> {
  const parsed = SettlementRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new InspectionInputError(
      "invalid inspection request",
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const provider = deps.provider === undefined ? visionProviderFromEnv() : deps.provider;
  try {
    return await proposeSettlement(parsed.data, {
      provider,
      store: deps.store ?? (provider ? await evidenceStore() : undefined),
      inspector: deps.inspector,
      memory: deps.memory !== undefined ? deps.memory : parsed.data.scooterId ? await inspectionMemory() : null,
      now: deps.now,
    });
  } catch (err) {
    if (err instanceof PhotoResolutionError) throw new InspectionInputError(err.message);
    if (err instanceof ProposalRepairError || err instanceof VisionProviderError) {
      throw new InspectionUpstreamError(`vision model output unusable: ${err.message}`);
    }
    throw err;
  }
}

/** Plain-object error payload shared by the A2A, MCP and REST faces. Never leaks stack traces or provider errors. */
export function errorPayload(err: unknown): { error: string; details?: string[]; status: 400 | 502 } {
  if (err instanceof InspectionInputError) return { error: err.message, ...(err.details.length ? { details: err.details } : {}), status: 400 };
  if (err instanceof InspectionUpstreamError) return { error: err.message, status: 502 };
  console.error("[inspector] inspection failed", (err as Error)?.name, (err as Error)?.message);
  return { error: "inspection provider failed", status: 502 };
}
