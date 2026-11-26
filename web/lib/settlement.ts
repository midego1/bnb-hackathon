import type { Hex } from "viem";
import { TOKEN } from "./contracts";
import type { Translate } from "./i18n/keys";

/** Response of POST /api/settlement (amounts are integer strings in token base units). */
export type InspectionResult = {
  tenantRefund: string;
  landlordClaim: string;
  reasons: string[];
  confidence: number;
  deposit: string;
  mock: boolean;
  provider: string;
  /** The vision model that answered (absent when the demo inspector did). */
  model?: string;
  /** Why the demo inspector answered although the server has a vision model (lib/server/settlement). */
  fallback?: "busy" | "limit" | "photos" | "error";
  reportHash: Hex;
  createdAt: string;
  /** ERC-8004 identity of the KeyScrow Inspector agent that signed reportHash (docs/AGENT.md). */
  inspector?: { name: string; address: Hex; agentId?: string; agentRegistry?: string };
  inspectorSignature?: Hex;
  /** Per-scooter inspection memory the inspector read before judging (Living Brain, or the local stand-in). */
  memory?: { provider: "living-brain" | "local"; configured: boolean; reason?: string; scooterId: string; recalled: string[]; error?: string };
  /** Atlas signed price report attached when damage is charged (verified server-side against the official signer). */
  priceProof?: { source: "atlas-pull"; hash: Hex; signer: Hex; payload: Hex; signature: Hex; prices: { feedId: number; price: string; timestamp: number }[] };
  /** True when this inspection was written to memory: only for a rental the server verified on-chain. */
  memoryStored?: boolean;
};

/**
 * A photo by its content hash, optionally with an angle label the inspector can cite in its reasons, and a url on this
 * app where the server can fetch the bytes when its evidence store does not have them.
 */
export type InspectionPhoto = Hex | { hash: Hex; label?: string; url?: string };
const photoRef = (p: InspectionPhoto) => (typeof p === "string" ? { hash: p } : p);

/** Who answered an inspection, for its label: the vision model, or the demo inspector and why. */
export function answeredBy(r: Pick<InspectionResult, "mock" | "fallback" | "model" | "provider">, t: Translate): string {
  if (!r.mock) return t("rental.move.visionModel", { model: r.model ?? r.provider });
  return r.fallback ? t("rental.move.demoFallback", { reason: t(`rental.move.fallback.${r.fallback}`) }) : t("rental.move.demoInspector");
}

/** Runs the AI return inspection over the pickup vs return photo hashes. */
export async function runInspection(input: {
  deposit: bigint;
  checkIn: InspectionPhoto[];
  checkOut: InspectionPhoto[];
  notes?: string;
  /** Scooter plate or listing id whose memory is read (read-only). */
  scooterId?: string;
  /** The rental being inspected: the server checks it on-chain, then reads and writes that rental's scooter memory. */
  lease?: Hex;
  chainId?: number;
}): Promise<InspectionResult> {
  const res = await fetch("/api/settlement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deposit: input.deposit.toString(),
      decimals: TOKEN.decimals,
      currency: "USDT",
      checkIn: input.checkIn.map(photoRef),
      checkOut: input.checkOut.map(photoRef),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.scooterId ? { scooterId: input.scooterId } : {}),
      ...(input.lease ? { lease: input.lease, chainId: input.chainId } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400) throw new Error(`The inspection request was rejected: ${body?.error ?? "invalid input"}.`);
    throw new Error("The AI inspector is unavailable right now. You can still propose a split by hand.");
  }
  return body as InspectionResult;
}
