import { formatUnits } from "viem";
import { canonicalJson, sha256Hex, type Bytes32Hex } from "../hash";
import type { EvidenceStore } from "../evidence/types";
import { mockAssessment } from "./mock";
import { extractJsonObject, repairProposal, type PhotoRef, type SettlementProposal, type SettlementRequest } from "./schema";
import type { InspectorIdentity, InspectorSigner } from "./inspector";
import type { VisionImage, VisionProvider } from "./vision";

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
  /** The inspector agent that produced and signed the report (ERC-8004 identity). Absent when no signer is set. */
  inspector?: InspectorIdentity;
  /**
   * sha256 of this object's canonical JSON (sorted keys) without `reportHash` and `inspectorSignature`;
   * pass it as `reportHash` to RentalEscrow.propose so the proposal is verifiable off-chain.
   */
  reportHash: Bytes32Hex;
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
  now?: Date;
}

export async function proposeSettlement(req: SettlementRequest, opts: ProposeOptions = {}): Promise<SettlementResult> {
  const deposit = BigInt(req.deposit);
  const provider = opts.provider ?? null;

  let raw: unknown;
  if (provider) {
    const [checkIn, checkOut] = await Promise.all([resolvePhotos(req.checkIn, opts.store), resolvePhotos(req.checkOut, opts.store)]);
    raw = await provider.assess({
      deposit: formatUnits(deposit, req.decimals),
      currency: req.currency,
      checkIn,
      checkOut,
      notes: req.notes,
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
    ...(opts.inspector ? { inspector: opts.inspector.identity } : {}),
    createdAt,
  };
  const reportHash = sha256Hex(canonicalJson(report));
  if (!opts.inspector) return { ...report, reportHash };
  return { ...report, reportHash, inspectorSignature: await opts.inspector.signReport(reportHash) };
}
