import type { Hex } from "viem";
import { TOKEN } from "./contracts";

/** Response of POST /api/settlement (amounts are integer strings in token base units). */
export type InspectionResult = {
  tenantRefund: string;
  landlordClaim: string;
  reasons: string[];
  confidence: number;
  deposit: string;
  mock: boolean;
  provider: string;
  reportHash: Hex;
  createdAt: string;
  /** ERC-8004 identity of the KeyEscrow Inspector agent that signed reportHash (docs/AGENT.md). */
  inspector?: { name: string; address: Hex; agentId?: string; agentRegistry?: string };
  inspectorSignature?: Hex;
  /** Per-scooter inspection memory the inspector read first (Living Brain, or the local stand-in). */
  memory?: { provider: "living-brain" | "local"; configured: boolean; reason?: string; scooterId: string; recalled: string[]; error?: string };
  memoryStored?: boolean;
};

/** A photo by its content hash, optionally with a room label the inspector can cite in its reasons. */
export type InspectionPhoto = Hex | { hash: Hex; label?: string };
const photoRef = (p: InspectionPhoto) => (typeof p === "string" ? { hash: p } : p);

/** Runs the AI return inspection over the pickup vs return photo hashes. */
export async function runInspection(input: {
  deposit: bigint;
  checkIn: InspectionPhoto[];
  checkOut: InspectionPhoto[];
  notes?: string;
  /** Scooter plate or listing id: keys the inspector's memory. */
  scooterId?: string;
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
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400) throw new Error(`The inspection request was rejected: ${body?.error ?? "invalid input"}.`);
    throw new Error("The AI inspector is unavailable right now. You can still propose a split by hand.");
  }
  return body as InspectionResult;
}
