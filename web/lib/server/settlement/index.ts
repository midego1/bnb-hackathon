import { formatUnits } from "viem";
import { canonicalJson, sha256Hex, type Bytes32Hex } from "../hash";
import { sniffContentType, type EvidenceStore } from "../evidence/types";
import { mockAssessment } from "./mock";
import { extractJsonObject, repairProposal, type PhotoRef, type RepairResult, type SettlementProposal, type SettlementRequest } from "./schema";
import type { InspectorIdentity, InspectorSigner } from "./inspector";
import { anthropicBusy, type VisionImage, type VisionProvider } from "./vision";
import type { InspectionMemory, MemoryStatus } from "../sponsors/livingbrain";

export * from "./schema";
export * from "./inspector";
export { visionProviderFromEnv, VisionProviderError, type VisionProvider } from "./vision";

/**
 * Why the demo inspector stood in although a vision model is configured: `busy` (Anthropic 429/5xx/529, out of
 * credit, network), `limit` (the server's daily AI inspection cap), `photos` (the photo bytes are not on this server),
 * `error` (the model refused or its answer was unusable).
 */
export type SettlementFallback = "busy" | "limit" | "photos" | "error";

export interface SettlementResult extends SettlementProposal {
  deposit: string;
  decimals: number;
  currency: string;
  /** True when produced by the deterministic mock rather than a vision model. */
  mock: boolean;
  /** Set when a vision model is configured but the mock answered instead, and why. */
  fallback?: SettlementFallback;
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
  /** Whether this inspection was written back to memory (after hashing): only for a rental verified on-chain. */
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

/** Largest photo the server fetches by url (Anthropic's per-image limit). */
const MAX_PHOTO_FETCH_BYTES = 5 * 1024 * 1024;

/** This app's static files: photo urls on `host` are read through `fetch` (the ASSETS binding, or public/ on disk). */
export type PhotoSource = { host: string; fetch: (url: string) => Promise<Response> };

/** A same-origin photo's bytes, or null (missing, too big, not an image, or not the bytes its hash promises). */
async function fetchPhoto(p: PhotoRef, source: PhotoSource): Promise<VisionImage | null> {
  const res = await source.fetch(p.url!).catch(() => null);
  if (!res?.ok || Number(res.headers.get("content-length")) > MAX_PHOTO_FETCH_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = sniffContentType(bytes);
  if (bytes.byteLength > MAX_PHOTO_FETCH_BYTES || !type || type === "application/pdf") return null;
  if (p.hash && sha256Hex(bytes) !== p.hash) return null;
  return { kind: "base64", mediaType: type, data: Buffer.from(bytes).toString("base64"), label: p.label };
}

/**
 * Turn photo refs into images a provider can consume: hashes are read from the evidence store; urls on this app's
 * own host are read here (the model could not reach a local or private host); other urls go to the model as is.
 */
async function resolvePhotos(photos: PhotoRef[], store: EvidenceStore | undefined, source: PhotoSource | undefined): Promise<VisionImage[]> {
  return Promise.all(
    photos.map(async (p): Promise<VisionImage> => {
      if (p.hash && store) {
        const ev = await store.get(p.hash as Bytes32Hex);
        if (ev && ev.contentType !== "application/pdf") {
          return { kind: "base64", mediaType: ev.contentType, data: Buffer.from(ev.bytes).toString("base64"), label: p.label };
        }
      }
      if (p.url && source && new URL(p.url).host === source.host) {
        const img = await fetchPhoto(p, source);
        if (img) return img;
      } else if (p.url) return { kind: "url", url: p.url, label: p.label };
      throw new PhotoResolutionError(`photo ${p.hash ?? "?"} is not in evidence storage and has no reachable url`);
    }),
  );
}

export interface ProposeOptions {
  /** Vision provider; null/undefined -> deterministic mock. */
  provider?: VisionProvider | null;
  /** Evidence store used to resolve photo hashes for the live provider. */
  store?: EvidenceStore;
  /** This app's static files: photo urls on its host are read as bytes. */
  photoSource?: PhotoSource;
  /** The caller already decided the mock answers although a model is configured (POST /api/settlement's daily cap). */
  fallback?: SettlementFallback;
  /** Inspector agent that signs the report; its identity is part of the hashed report. Null/undefined -> unsigned. */
  inspector?: InspectorSigner | null;
  /** Per-scooter inspection memory (Living Brain, or the local stand-in). Read before judging; see `rememberAs` for writes. */
  memory?: InspectionMemory | null;
  /**
   * Write this inspection to `memory` under this scooter id (it is also the id recalled). Only POST /api/settlement
   * sets it, after verifying the rental on-chain (settlement/lease.ts); without it memory is read-only, so the public
   * agent faces (A2A, MCP) and requests without a real rental never write.
   */
  rememberAs?: { scooterId: string; rental: string } | null;
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
  const scooterId = opts.rememberAs?.scooterId ?? req.scooterId;
  if (opts.memory && scooterId) {
    try {
      const recalled = (await opts.memory.recall(scooterId)).map((m) => m.text);
      memory = { ...opts.memory.status, scooterId, recalled };
    } catch (err) {
      memory = { ...opts.memory.status, scooterId, recalled: [], error: (err as Error).message.slice(0, 200) };
    }
  }
  const notes = memory ? [req.notes, memoryNotes(memory.recalled)].filter(Boolean).join("\n\n") : req.notes;

  let fallback = opts.fallback;
  let judged: RepairResult | null = null;
  if (provider && !fallback) {
    try {
      const [checkIn, checkOut] = await Promise.all([resolvePhotos(req.checkIn, opts.store, opts.photoSource), resolvePhotos(req.checkOut, opts.store, opts.photoSource)]);
      let raw = await provider.assess({ deposit: formatUnits(deposit, req.decimals), currency: req.currency, checkIn, checkOut, notes });
      if (typeof raw === "string") raw = extractJsonObject(raw);
      judged = repairProposal(raw, deposit, req.decimals);
    } catch (err) {
      // The demo never dead-ends: the deterministic inspector answers instead, and the report says why.
      fallback = err instanceof PhotoResolutionError ? "photos" : anthropicBusy(err) ? "busy" : "error";
      console.warn("settlement: demo inspector stood in", fallback, (err as Error).name, (err as { status?: number }).status ?? "");
    }
  }
  const live = judged ? provider : null;
  const { proposal, repairs } = judged ?? repairProposal(mockAssessment(req), deposit, req.decimals);
  const createdAt = (opts.now ?? new Date()).toISOString();
  const report = {
    ...proposal,
    deposit: req.deposit,
    decimals: req.decimals,
    currency: req.currency,
    mock: !live,
    provider: live?.name ?? "mock",
    ...(live ? { model: live.model } : {}),
    ...(provider && !live ? { fallback } : {}),
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
  let memoryStored: boolean | undefined = memory ? false : undefined;
  // A stand-in verdict never goes into the scooter's history: later inspections trust it as pre-existing damage.
  if (opts.memory && opts.rememberAs && !fallback) {
    const { scooterId: id, rental } = opts.rememberAs;
    const res = await opts.memory
      .remember({ scooterId: id, rental, at: createdAt, findings: proposal.reasons, newDamage: BigInt(proposal.landlordClaim) > BigInt(0), reportHash })
      .catch((err: Error) => ({ stored: false, error: err.message }));
    memoryStored = res.stored;
  }
  const extra = memoryStored === undefined ? {} : { memoryStored };
  if (!opts.inspector) return { ...report, reportHash, ...extra };
  return { ...report, reportHash, inspectorSignature: await opts.inspector.signReport(reportHash), ...extra };
}
