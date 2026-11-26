import type { InspectionMemory } from "../../web/lib/server/sponsors/livingbrain.ts";
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
  /**
   * Where photo hashes are resolved for a live provider when `store` is unset, loaded lazily (mock mode never touches
   * it): the web app's store on disk under Node (src/node-deps.ts), the R2 bucket on Workers. None -> photos need urls.
   */
  loadStore?: () => Promise<EvidenceStore | undefined>;
  /**
   * Per-scooter inspection memory, read-only here: recalled before judging, never written (proposeSettlement writes
   * only with `rememberAs`, which only the web app's POST /api/settlement sets after checking the rental on-chain).
   * null = none. Defaults to `loadMemory()` when the request names a scooterId.
   */
  memory?: InspectionMemory | null;
  /**
   * Living Brain (LIVING_BRAIN_*) or the web app's local stand-in under Node (src/node-deps.ts); on Workers only
   * Living Brain (no disk). Loaded lazily, only for requests with a scooterId.
   */
  loadMemory?: () => Promise<InspectionMemory | null>;
  now?: Date;
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
      store: deps.store ?? (provider ? await deps.loadStore?.() : undefined),
      inspector: deps.inspector,
      memory: deps.memory !== undefined ? deps.memory : parsed.data.scooterId ? ((await deps.loadMemory?.()) ?? null) : null,
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
