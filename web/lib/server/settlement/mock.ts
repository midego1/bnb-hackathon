import { createHash } from "node:crypto";
import { formatUnits } from "viem";
import type { PhotoRef, SettlementRequest } from "./schema";

const FINDINGS = [
  "scuff marks on the wall not visible at check-in (est. repaint).",
  "stain on the floor covering (est. professional cleaning).",
  "cabinet door hinge loose; door does not close fully (est. repair).",
  "grout or sealant discoloured beyond normal wear (est. re-seal).",
  "small chip in a countertop or tile edge (est. filler repair).",
  "window blind slat bent (est. replacement slat).",
  "light bulb missing from a fixture (est. replacement).",
  "appliance not cleaned; grease build-up visible (est. cleaning).",
] as const;

function photoKey(p: PhotoRef): string {
  return p.hash ?? p.url ?? "";
}

/**
 * Deterministic stand-in for the vision model, used whenever no LLM key is configured.
 * Same input -> same proposal. Photos whose hash/url appears in both sets are treated as
 * "unchanged"; each check-out photo without a check-in twin is treated as a finding.
 * Returns the raw (human-unit) shape a model would, so it goes through the same repair path.
 */
export function mockAssessment(req: SettlementRequest) {
  const before = new Set(req.checkIn.map(photoKey));
  const changed = req.checkOut.filter((p) => !before.has(photoKey(p)));
  const seedHex = createHash("sha256")
    .update(JSON.stringify([req.deposit, req.checkIn.map(photoKey), req.checkOut.map(photoKey)]))
    .digest("hex");
  const seed = parseInt(seedHex.slice(0, 8), 16);

  const deposit = BigInt(req.deposit);
  const unit = BigInt(10) ** BigInt(req.decimals);
  const fmt = (v: bigint) => formatUnits(v, req.decimals);

  if (changed.length === 0) {
    return {
      tenantRefund: fmt(deposit),
      landlordClaim: "0",
      reasons: ["Check-out photos match the check-in set; no damage beyond normal wear."],
      confidence: 0.9,
    };
  }

  // 8% of the deposit per changed photo plus 0-4% jitter from the seed, capped at 60% (basis points).
  const shareBp = BigInt(Math.min(6000, changed.length * 800 + (seed % 5) * 100));
  // Round the claim down to whole currency units so the demo numbers look like a human wrote them.
  let landlordClaim = ((deposit * shareBp) / BigInt(10000) / unit) * unit;
  if (landlordClaim === BigInt(0)) landlordClaim = (deposit * shareBp) / BigInt(10000);
  const reasons = changed
    .slice(0, 5)
    .map((p, i) => {
      const finding = FINDINGS[(seed + i) % FINDINGS.length];
      return `${p.label ?? `Check-out photo ${req.checkOut.indexOf(p) + 1}`}: ${finding}`;
    });

  return {
    tenantRefund: fmt(deposit - landlordClaim),
    landlordClaim: fmt(landlordClaim),
    reasons,
    confidence: Math.round((0.55 + (seed % 30) / 100) * 100) / 100,
  };
}
