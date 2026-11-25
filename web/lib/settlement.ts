import type { Hex } from "viem";

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
};

/** Runs the AI move-out inspection over the check-in vs check-out photo hashes. */
export async function runInspection(input: {
  deposit: bigint;
  checkIn: Hex[];
  checkOut: Hex[];
  notes?: string;
}): Promise<InspectionResult> {
  const res = await fetch("/api/settlement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deposit: input.deposit.toString(),
      decimals: 6,
      currency: "USDT",
      checkIn: input.checkIn.map((hash) => ({ hash })),
      checkOut: input.checkOut.map((hash) => ({ hash })),
      ...(input.notes ? { notes: input.notes } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400) throw new Error(`The inspection request was rejected: ${body?.error ?? "invalid input"}.`);
    throw new Error("The AI inspector is unavailable right now. You can still propose a split by hand.");
  }
  return body as InspectionResult;
}
