import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { LeaseStatus } from "@/lib/contracts";
import { amountDue, crc16, DEMO_PROXY_ID, promptPayPayload, thbFor } from "@/lib/promptpay";
import { DemoError, RateLimiter } from "@/lib/server/demoTestnet/guards";
import { checkRate, ONRAMP_MAX, onRampPlan } from "@/lib/server/onramp";

const U = BigInt(1_000_000);
const TOKEN = "0x00000000000000000000000000000000000000aa" as Address;
const TENANT = "0x00000000000000000000000000000000000000bb" as Address;
const lease = (o: Partial<{ status: number; monthsFunded: number; deposit: bigint; rent: bigint; token: Address; isLease: boolean }> = {}) => ({
  isLease: o.isLease ?? true,
  token: o.token ?? TOKEN,
  status: o.status ?? LeaseStatus.Created,
  monthsFunded: o.monthsFunded ?? 0,
  terms: { tenant: TENANT, depositAmount: o.deposit ?? BigInt(200) * U, rentAmount: o.rent ?? BigInt(100) * U, termMonths: 3 },
});
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DemoError) return { status: e.status, code: e.code };
    throw e;
  }
};

describe("PromptPay payload", () => {
  it("uses CRC-16/CCITT-FALSE", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("is a dynamic THB PromptPay payload for the fake proxy id, ending with a valid CRC", () => {
    const p = promptPayPayload(10200.5);
    expect(p.startsWith("000201010212")).toBe(true);
    expect(p).toContain(`29370016A0000006770101110213${DEMO_PROXY_ID}`);
    expect(p).toContain("5303764");
    expect(p).toContain("540810200.50");
    expect(p).toContain("5802TH");
    expect(p.slice(-8, -4)).toBe("6304");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it("refuses non-positive amounts", () => {
    expect(() => promptPayPayload(0)).toThrow();
    expect(() => promptPayPayload(Number.NaN)).toThrow();
  });
});

describe("PromptPay amount math", () => {
  it("converts mUSDT to baht, rounded to the satang", () => {
    expect(thbFor(BigInt(300) * U, 33)).toBe(9900);
    expect(thbFor(BigInt(1_234_567), 33.1)).toBe(40.86); // 1.234567 * 33.1 = 40.864...
  });

  it("owes deposit + first month before funding, one month while active, nothing after the term or once closed", () => {
    expect(amountDue(lease())).toEqual({ amount: BigInt(300) * U, what: "fund" });
    expect(amountDue(lease({ status: LeaseStatus.Active, monthsFunded: 1 }))).toEqual({ amount: BigInt(100) * U, what: "rent" });
    expect(amountDue(lease({ status: LeaseStatus.Active, monthsFunded: 3 }))).toBeUndefined();
    expect(amountDue(lease({ status: LeaseStatus.MoveOut }))).toBeUndefined();
  });
});

describe("demo on-ramp guards", () => {
  it("mints exactly what is due, to the lease's renter, on 31337 and 97", () => {
    expect(onRampPlan(31337, lease(), TOKEN)).toEqual({ to: TENANT, amount: BigInt(300) * U });
    expect(onRampPlan(97, lease({ status: LeaseStatus.Active, monthsFunded: 1 }), TOKEN)).toEqual({ to: TENANT, amount: BigInt(100) * U });
  });

  it("refuses other chains, foreign contracts, other tokens, nothing due and amounts over the cap", () => {
    expect(refusal(() => onRampPlan(56, lease(), TOKEN))).toEqual({ status: 404, code: "wrong-chain" });
    expect(refusal(() => onRampPlan(31337, lease({ isLease: false }), TOKEN))).toEqual({ status: 400, code: "not-a-lease" });
    expect(refusal(() => onRampPlan(31337, lease({ token: TENANT }), TOKEN))).toEqual({ status: 400, code: "wrong-token" });
    expect(refusal(() => onRampPlan(31337, lease({ status: LeaseStatus.Settled }), TOKEN))).toEqual({ status: 409, code: "nothing-due" });
    expect(refusal(() => onRampPlan(31337, lease({ deposit: ONRAMP_MAX }), TOKEN))).toEqual({ status: 400, code: "over-cap" });
  });

  it("is rate-limited", () => {
    const l = new RateLimiter({ minGapMs: 5_000, runsPerHour: 2 });
    checkRate(0, l);
    expect(refusal(() => checkRate(1_000, l))).toEqual({ status: 429, code: "rate-limited" });
    checkRate(6_000, l);
    expect(refusal(() => checkRate(20_000, l))).toEqual({ status: 429, code: "rate-limited" }); // hourly cap
  });
});
