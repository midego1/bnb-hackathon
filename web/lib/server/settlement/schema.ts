import { formatUnits, parseUnits } from "viem";
import { z } from "zod";
import { BYTES32_RE } from "../hash";

/** MockUSDT (and real USDT on BNB Chain testnets used here) has 6 decimals. */
export const DEFAULT_DECIMALS = 6;
export const MAX_PHOTOS_PER_SET = 20;
export const MAX_REASONS = 10;
export const MAX_REASON_LENGTH = 300;

const baseUnits = z
  .string()
  .regex(/^\d{1,40}$/, "must be a non-negative integer string in token base units");

export const PhotoRefSchema = z
  .object({
    /** sha256 content hash returned by POST /api/evidence. */
    hash: z
      .string()
      .transform((s) => s.trim().toLowerCase())
      .pipe(z.string().regex(BYTES32_RE, "must be a 0x-prefixed 32-byte hex sha256"))
      .optional(),
    /** Publicly reachable image URL (https, or http for local dev). */
    url: z.url({ protocol: /^https?$/ }).optional(),
    /** Optional angle label, e.g. "left side" or "plate close-up". */
    label: z.string().max(120).optional(),
  })
  .strict()
  .refine((p) => p.hash !== undefined || p.url !== undefined, "each photo needs a hash or a url");

export type PhotoRef = z.infer<typeof PhotoRefSchema>;

const photoSet = z.array(PhotoRefSchema).min(1).max(MAX_PHOTOS_PER_SET);

export const SettlementRequestSchema = z
  .object({
    /** Deposit held in escrow, as an integer string in token base units (MockUSDT: 6 decimals). */
    deposit: baseUnits.refine((s) => /^\d+$/.test(s) && BigInt(s) > BigInt(0), "deposit must be > 0"),
    decimals: z.number().int().min(0).max(36).default(DEFAULT_DECIMALS),
    currency: z.string().min(1).max(12).default("USDT"),
    checkIn: photoSet,
    checkOut: photoSet,
    /** Free-text context from either party (rental terms, known pre-existing scratches, ...). */
    notes: z.string().max(2000).optional(),
    /** Scooter identifier (plate or listing id) whose inspection memory (Living Brain) is read before judging. */
    scooterId: z.string().trim().min(1).max(64).regex(/^[\p{L}\p{M}\p{N} _.:#-]+$/u, "letters, digits, space and _ . : # - only").optional(),
  })
  .strict();

export type SettlementRequest = z.infer<typeof SettlementRequestSchema>;

/** The proposal returned by POST /api/settlement. Amounts are base-unit integer strings. */
export const SettlementProposalSchema = z
  .object({
    tenantRefund: baseUnits,
    landlordClaim: baseUnits,
    reasons: z.array(z.string().min(1).max(MAX_REASON_LENGTH)).min(1).max(MAX_REASONS),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type SettlementProposal = z.infer<typeof SettlementProposalSchema>;

/**
 * Loose shape we accept from a model before repair. Models are asked for human-unit amounts
 * (e.g. 125.5 USDT); numbers, numeric strings and percentages for confidence are tolerated.
 */
const looseAmount = z.union([z.number(), z.string()]).nullish();
const LooseProposalSchema = z
  .object({
    tenantRefund: looseAmount,
    landlordClaim: looseAmount,
    reasons: z.union([z.array(z.unknown()), z.string()]).nullish(),
    confidence: z.union([z.number(), z.string()]).nullish(),
  })
  .loose();

export class ProposalRepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRepairError";
  }
}

export interface RepairResult {
  proposal: SettlementProposal;
  /** Human-readable notes on every fix applied; empty when the model output was already valid. */
  repairs: string[];
}

/**
 * Extract the first JSON object from model text. Tolerates ```json fences and prose around it.
 * Throws ProposalRepairError when no parseable object is present.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [trimmed, fenced?.[1]?.trim()];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed: unknown = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  throw new ProposalRepairError("model output contained no JSON object");
}

/** Human-unit amount (number or decimal string) -> base units, or null when unusable. */
function toBaseUnits(value: number | string | null | undefined, decimals: number): bigint | null {
  if (value === null || value === undefined) return null;
  let str: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    str = value.toFixed(decimals);
  } else {
    str = value.trim().replace(/[,_\s]/g, "").replace(/^\$/, "");
    if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
  }
  const negative = str.startsWith("-");
  if (negative) return BigInt(-1);
  const [whole, frac = ""] = str.split(".");
  try {
    return parseUnits(`${whole}.${frac.slice(0, decimals) || "0"}`, decimals);
  } catch {
    return null;
  }
}

function clamp(v: bigint, min: bigint, max: bigint) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Validate and repair a model's settlement output against the deposit so the result is always
 * safe to submit on-chain: amounts are clamped to [0, deposit] and tenantRefund + landlordClaim
 * equals the deposit exactly. When the two amounts disagree, landlordClaim wins, because it is the
 * figure the itemised reasons justify; tenantRefund is derived from it.
 */
export function repairProposal(raw: unknown, deposit: bigint, decimals = DEFAULT_DECIMALS): RepairResult {
  if (deposit <= BigInt(0)) throw new ProposalRepairError("deposit must be > 0");
  const parsed = LooseProposalSchema.safeParse(raw);
  if (!parsed.success) throw new ProposalRepairError("model output is not an object with proposal fields");
  const data = parsed.data;
  const repairs: string[] = [];
  const zero = BigInt(0);
  const fmt = (v: bigint) => formatUnits(v, decimals);

  let claim = toBaseUnits(data.landlordClaim, decimals);
  let refund = toBaseUnits(data.tenantRefund, decimals);
  if (data.landlordClaim != null && claim === null) repairs.push("landlordClaim was not a number; ignored");
  if (data.tenantRefund != null && refund === null) repairs.push("tenantRefund was not a number; ignored");
  if (claim === null && refund === null) {
    throw new ProposalRepairError("model output has neither tenantRefund nor landlordClaim");
  }

  if (claim !== null && (claim < zero || claim > deposit)) {
    const c = clamp(claim, zero, deposit);
    repairs.push(`landlordClaim clamped to ${fmt(c)} (deposit is ${fmt(deposit)})`);
    claim = c;
  }
  if (refund !== null && (refund < zero || refund > deposit)) {
    const r = clamp(refund, zero, deposit);
    repairs.push(`tenantRefund clamped to ${fmt(r)} (deposit is ${fmt(deposit)})`);
    refund = r;
  }

  if (claim === null) {
    claim = deposit - refund!;
    repairs.push("landlordClaim missing; derived as deposit - tenantRefund");
  } else if (refund === null) {
    refund = deposit - claim;
    repairs.push("tenantRefund missing; derived as deposit - landlordClaim");
  } else if (claim + refund !== deposit) {
    refund = deposit - claim;
    repairs.push(`amounts did not sum to the deposit; tenantRefund set to ${fmt(refund)}`);
  }

  let reasons: string[] = [];
  if (typeof data.reasons === "string") {
    reasons = [data.reasons];
    repairs.push("reasons was a string; wrapped in an array");
  } else if (Array.isArray(data.reasons)) {
    reasons = data.reasons.filter((r): r is string => typeof r === "string");
    if (reasons.length !== data.reasons.length) repairs.push("dropped non-string reasons");
  }
  reasons = reasons.map((r) => r.trim()).filter(Boolean);
  if (reasons.some((r) => r.length > MAX_REASON_LENGTH)) {
    reasons = reasons.map((r) => (r.length > MAX_REASON_LENGTH ? `${r.slice(0, MAX_REASON_LENGTH - 1)}…` : r));
    repairs.push(`reasons truncated to ${MAX_REASON_LENGTH} characters`);
  }
  if (reasons.length > MAX_REASONS) {
    reasons = reasons.slice(0, MAX_REASONS);
    repairs.push(`reasons capped at ${MAX_REASONS}`);
  }
  if (reasons.length === 0) {
    reasons = [
      claim > zero
        ? "Deduction proposed without an itemised reason; review the photos before accepting."
        : "No damage beyond normal wear identified.",
    ];
    repairs.push("reasons missing; added a default reason");
  }

  let confidence = typeof data.confidence === "string" ? Number(data.confidence.replace("%", "")) : data.confidence;
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
    confidence = 0.5;
    repairs.push("confidence missing or invalid; set to 0.5");
  } else if (confidence > 1 && confidence <= 100) {
    confidence = confidence / 100;
    repairs.push("confidence looked like a percentage; scaled to 0..1");
  }
  if (confidence < 0 || confidence > 1) {
    confidence = Math.min(1, Math.max(0, confidence));
    repairs.push("confidence clamped to 0..1");
  }
  confidence = Math.round(confidence * 1000) / 1000;

  // Postcondition: the strict schema and the on-chain invariant.
  const proposal = SettlementProposalSchema.parse({
    tenantRefund: (refund ?? deposit - claim).toString(),
    landlordClaim: claim.toString(),
    reasons,
    confidence,
  });
  if (BigInt(proposal.tenantRefund) + BigInt(proposal.landlordClaim) !== deposit) {
    throw new ProposalRepairError("internal: repaired amounts do not sum to the deposit");
  }
  return { proposal, repairs };
}
