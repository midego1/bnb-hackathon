import { describe, expect, it } from "vitest";
import { extractJsonObject, ProposalRepairError, repairProposal, SettlementProposalSchema } from "@/lib/server/settlement/schema";

const DEPOSIT = BigInt(500_000_000); // 500 USDT at 6 decimals
const sum = (p: { tenantRefund: string; landlordClaim: string }) => BigInt(p.tenantRefund) + BigInt(p.landlordClaim);

describe("repairProposal", () => {
  it("passes a valid proposal through untouched", () => {
    const { proposal, repairs } = repairProposal(
      { tenantRefund: 450, landlordClaim: 50, reasons: ["Wall scuffs: 50 USDT"], confidence: 0.8 },
      DEPOSIT,
    );
    expect(repairs).toEqual([]);
    expect(proposal).toEqual({ tenantRefund: "450000000", landlordClaim: "50000000", reasons: ["Wall scuffs: 50 USDT"], confidence: 0.8 });
    expect(SettlementProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it("makes amounts sum to the deposit, trusting landlordClaim", () => {
    const { proposal, repairs } = repairProposal({ tenantRefund: 400, landlordClaim: 50, reasons: ["x"], confidence: 0.7 }, DEPOSIT);
    expect(proposal.landlordClaim).toBe("50000000");
    expect(proposal.tenantRefund).toBe("450000000");
    expect(sum(proposal)).toBe(DEPOSIT);
    expect(repairs.join()).toMatch(/did not sum/);
  });

  it("clamps an over-claim to the deposit", () => {
    const { proposal } = repairProposal({ tenantRefund: 0, landlordClaim: 9999, reasons: ["x"], confidence: 0.7 }, DEPOSIT);
    expect(proposal.landlordClaim).toBe(DEPOSIT.toString());
    expect(proposal.tenantRefund).toBe("0");
  });

  it("clamps negative amounts to zero", () => {
    const { proposal } = repairProposal({ tenantRefund: 600, landlordClaim: -100, reasons: ["x"], confidence: 0.5 }, DEPOSIT);
    expect(proposal.landlordClaim).toBe("0");
    expect(proposal.tenantRefund).toBe(DEPOSIT.toString());
  });

  it("derives a missing amount", () => {
    expect(repairProposal({ tenantRefund: 480, reasons: ["x"], confidence: 0.9 }, DEPOSIT).proposal.landlordClaim).toBe("20000000");
    expect(repairProposal({ landlordClaim: "125.5", reasons: ["x"], confidence: 0.9 }, DEPOSIT).proposal.tenantRefund).toBe("374500000");
  });

  it("accepts numeric strings with separators and truncates extra decimals", () => {
    const { proposal } = repairProposal({ landlordClaim: "$1,0.1234567", tenantRefund: null, reasons: ["x"], confidence: 1 }, DEPOSIT);
    expect(proposal.landlordClaim).toBe("10123456");
    expect(sum(proposal)).toBe(DEPOSIT);
  });

  it("rejects output with no usable amounts", () => {
    expect(() => repairProposal({ reasons: ["x"] }, DEPOSIT)).toThrow(ProposalRepairError);
    expect(() => repairProposal({ landlordClaim: "lots", tenantRefund: {} }, DEPOSIT)).toThrow(ProposalRepairError);
    expect(() => repairProposal("nope", DEPOSIT)).toThrow(ProposalRepairError);
    expect(() => repairProposal([1, 2], DEPOSIT)).toThrow(ProposalRepairError);
  });

  it("repairs reasons: string, non-strings, empty, too many, too long", () => {
    expect(repairProposal({ landlordClaim: 1, reasons: "one reason", confidence: 1 }, DEPOSIT).proposal.reasons).toEqual(["one reason"]);
    expect(repairProposal({ landlordClaim: 1, reasons: ["ok", 3, null, "  "], confidence: 1 }, DEPOSIT).proposal.reasons).toEqual(["ok"]);
    expect(repairProposal({ landlordClaim: 1, confidence: 1 }, DEPOSIT).proposal.reasons[0]).toMatch(/without an itemised reason/);
    expect(repairProposal({ landlordClaim: 0, confidence: 1 }, DEPOSIT).proposal.reasons[0]).toMatch(/No damage/);
    expect(repairProposal({ landlordClaim: 1, reasons: Array(15).fill("r"), confidence: 1 }, DEPOSIT).proposal.reasons).toHaveLength(10);
    expect(repairProposal({ landlordClaim: 1, reasons: ["x".repeat(400)], confidence: 1 }, DEPOSIT).proposal.reasons[0]).toHaveLength(300);
  });

  it("repairs confidence: percentage, string, out of range, missing", () => {
    const c = (confidence: unknown) => repairProposal({ landlordClaim: 1, reasons: ["x"], confidence }, DEPOSIT).proposal.confidence;
    expect(c(85)).toBe(0.85);
    expect(c("70%")).toBe(0.7);
    expect(c(-2)).toBe(0);
    expect(c(500)).toBe(1);
    expect(c(undefined)).toBe(0.5);
    expect(c("high")).toBe(0.5);
  });

  it("always yields an on-chain-safe proposal for random garbage amounts", () => {
    for (let i = 0; i < 200; i++) {
      const r = () => (Math.random() - 0.3) * 2000;
      const { proposal } = repairProposal({ tenantRefund: r(), landlordClaim: r(), reasons: ["x"], confidence: Math.random() * 3 }, DEPOSIT);
      expect(sum(proposal)).toBe(DEPOSIT);
      expect(BigInt(proposal.landlordClaim) >= BigInt(0)).toBe(true);
      expect(BigInt(proposal.tenantRefund) >= BigInt(0)).toBe(true);
      expect(SettlementProposalSchema.safeParse(proposal).success).toBe(true);
    }
  });
});

describe("extractJsonObject", () => {
  it("parses plain, fenced and prose-wrapped JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
  });

  it("throws when there is no object", () => {
    expect(() => extractJsonObject("no json here")).toThrow(ProposalRepairError);
    expect(() => extractJsonObject("[1,2]")).toThrow(ProposalRepairError);
  });
});
