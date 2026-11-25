import { formatUnits } from "viem";
import { canonicalJson, sha256Hex, type Bytes32Hex } from "../hash";
import type { EvidenceStore } from "../evidence/types";
import { mockAssessment } from "./mock";
import { extractJsonObject, repairProposal, type PhotoRef, type SettlementProposal, type SettlementRequest } from "./schema";
import type { InspectorIdentity, InspectorSigner } from "./inspector";
import type { VisionImage, VisionProvider } from "./vision";
import type { InspectionMemory, MemoryStatus } from "../sponsors/livingbrain";

export * from "./schema";
export * from "./inspector";
export { visionProviderFromEnv, VisionProviderError, type VisionProvider } from "./vision";

export interface SettlementResult extends SettlementProposal {
  deposit: string;
  decimals: number;
  currency: string;
  /** True when produced by the deterministic mock rather than a vision model. */
  mock: boolean;
  provider: string;
  model?: string;
  /** Fixes applied to the model output so it satisfies the schema and sums to the deposit. */
  repairs: string[];
  checkIn: PhotoRef[];
  checkOut: PhotoRef[];
  /** The caller's notes, when given: they steer the model, so they are part of the hashed report. */
  notes?: string;
  /** The inspector agent that produced and signed the report (ERC-8004 identity). Absent when no signer is set. */
  inspector?: InspectorIdentity;
  /**
   * sha256 of this object's canonical JSON (sorted keys) without `reportHash` and `inspectorSignature`;
   * pass it as `reportHash` to RentalEscrow.propose so the proposal is verifiable off-chain.
   */
  reportHash: Bytes32Hex;
  /** Per-scooter memory the inspector read before judging (part of the hashed report). */
  memory?: MemoryStatus & { scooterId: string; recalled: string[]; error?: string };
  /** Whether this inspection was written back to memory (after hashing). */
  memoryStored?: boolean;
  /** EIP-191 signature of `reportHash` by `inspector.address`. */
  inspectorSignature?: `0x${string}`;
  createdAt: string;
}

export class PhotoResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoResolutionError";
  }
}

/** Turn photo refs into images a provider can consume: hashes are read from the evidence store. */
async function resolvePhotos(photos: PhotoRef[], store: EvidenceStore | undefined): Promise<VisionImage[]> {
  return Promise.all(
    photos.map(async (p): Promise<VisionImage> => {
      if (p.hash && store) {
        const ev = await store.get(p.hash as Bytes32Hex);
        if (ev && ev.contentType !== "application/pdf") {
          return { kind: "base64", mediaType: ev.contentType, data: Buffer.from(ev.bytes).toString("base64"), label: p.label };
        }
      }
      if (p.url) return { kind: "url", url: p.url, label: p.label };
      throw new PhotoResolutionError(`photo ${p.hash ?? "?"} is not in evidence storage and has no url`);
    }),
  );
}

export interface ProposeOptions {
  /** Vision provider; null/undefined -> deterministic mock. */
  provider?: VisionProvider | null;
  /** Evidence store used to resolve photo hashes for the live provider. */
  store?: EvidenceStore;
  /** Inspector agent that signs the report; its identity is part of the hashed report. Null/undefined -> unsigned. */
  inspector?: InspectorSigner | null;
  /** Per-scooter inspection memory (Living Brain, or the local stand-in). Used when the request has a scooterId. */
  memory?: InspectionMemory | null;
  now?: Date;
}

/** Text the inspector gets about earlier inspections, so known damage is never charged twice. */
export function memoryNotes(recalled: string[]): string {
  if (!recalled.length) return "Inspection memory: no earlier inspections recorded for this scooter.";
  return [
    "Inspection memory (earlier inspections of this scooter). Damage listed here already existed before this rental: do NOT charge the renter for it again; say so in the reasons if you see it.",
    ...recalled.map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");
}

export async function proposeSettlement(req: SettlementRequest, opts: ProposeOptions = {}): Promise<SettlementResult> {
  const deposit = BigInt(req.deposit);
  const provider = opts.provider ?? null;

  let memory: SettlementResult["memory"];
  if (opts.memory && req.scooterId) {
    try {
      const recalled = (await opts.memory.recall(req.scooterId)).map((m) => m.text);
      memory = { ...opts.memory.status, scooterId: req.scooterId, recalled };
    } catch (err) {
      memory = { ...opts.memory.status, scooterId: req.scooterId, recalled: [], error: (err as Error).message.slice(0, 200) };
    }
  }
  const notes = memory ? [req.notes, memoryNotes(memory.recalled)].filter(Boolean).join("\n\n") : req.notes;

  let raw: unknown;
  if (provider) {
    const [checkIn, checkOut] = await Promise.all([resolvePhotos(req.checkIn, opts.store), resolvePhotos(req.checkOut, opts.store)]);
    raw = await provider.assess({
      deposit: formatUnits(deposit, req.decimals),
      currency: req.currency,
      checkIn,
      checkOut,
      notes,
    });
    if (typeof raw === "string") raw = extractJsonObject(raw);
  } else {
    raw = mockAssessment(req);
  }

  const { proposal, repairs } = repairProposal(raw, deposit, req.decimals);
  const createdAt = (opts.now ?? new Date()).toISOString();
  const report = {
    ...proposal,
    deposit: req.deposit,
    decimals: req.decimals,
    currency: req.currency,
    mock: !provider,
    provider: provider?.name ?? "mock",
    ...(provider ? { model: provider.model } : {}),
    repairs,
    checkIn: req.checkIn,
    checkOut: req.checkOut,
    // The caller's notes steer the model, so they are part of what the inspector signs.
    ...(req.notes ? { notes: req.notes } : {}),
    ...(opts.inspector ? { inspector: opts.inspector.identity } : {}),
    ...(memory ? { memory } : {}),
    createdAt,
  };
  const reportHash = sha256Hex(canonicalJson(report));
  let memoryStored: boolean | undefined;
  if (opts.memory && req.scooterId) {
    const res = await opts.memory
      .remember({ scooterId: req.scooterId, at: createdAt, findings: proposal.reasons, newDamage: BigInt(proposal.landlordClaim) > BigInt(0), reportHash })
      .catch((err: Error) => ({ stored: false, error: err.message }));
    memoryStored = res.stored;
  }
  const extra = memoryStored === undefined ? {} : { memoryStored };
  if (!opts.inspector) return { ...report, reportHash, ...extra };
  return { ...report, reportHash, inspectorSignature: await opts.inspector.signReport(reportHash), ...extra };
}
