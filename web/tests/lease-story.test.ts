import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { zeroHash, type Address, type Hex } from "viem";
import { rentalCopyFor } from "@/components/lease/copy";
import { banner, LANDLORD_TIMEOUT_BASIS, monthCells, moneyFlow, returnPlan } from "@/components/lease/story";
import { renterCopyFor, renterLine } from "@/components/roles/renterStory";
import { en as enDictionary } from "@/lib/i18n/dictionaries/en";
import { makeT as makeEnglishT } from "@/lib/i18n/t";
import { stateFor } from "@/lib/i18n/server";
import { LeaseStatus } from "@/lib/contracts";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import type { RentalSummary } from "@/lib/rentals";

const renterCopy = renterCopyFor(makeEnglishT({ mode: "en", dict: enDictionary }));
const rentalCopy = rentalCopyFor(makeEnglishT({ mode: "en", dict: enDictionary }));

const OWNER = "0x0000000000000000000000000000000000000001" as Address;
const RENTER = "0x0000000000000000000000000000000000000002" as Address;
const DESK = "0x0000000000000000000000000000000000000003" as Address;
const DAY = BigInt(86_400);
const MONTH = BigInt(30) * DAY;
const T0 = BigInt(1_795_000_000);
const RENT = BigInt(100_000_000);
const DEPOSIT = BigInt(200_000_000);
const fmt = (v: bigint) => `${Number(v) / 1e6}u`;

function lease(p: Partial<LeaseData> = {}): LeaseData {
  return {
    address: "0x00000000000000000000000000000000000000a1",
    terms: {
      token: "0x00000000000000000000000000000000000000c1", landlord: OWNER, tenant: RENTER, arbiter: DESK, rentAmount: RENT, depositAmount: DEPOSIT,
      termPeriods: 3, rentPeriod: 30 * 86_400, responseWindow: 7 * 86_400, arbiterWindow: 14 * 86_400, leaseHash: zeroHash, feeBps: 1000, feeRecipient: DESK,
    },
    status: LeaseStatus.Active, startTime: T0, periodsFunded: 1, periodsReleased: 0, periodsDue: 1, checkInHash: zeroHash, checkOutHash: zeroHash,
    proposal: { tenantRefund: BigInt(0), landlordClaim: BigInt(0), reportHash: zeroHash, proposer: "0x0000000000000000000000000000000000000000", proposedAt: BigInt(0), nonce: 0 },
    timeoutAt: BigInt(0), arbiterDeadline: BigInt(0), disputedAt: BigInt(0), feeCharged: false, balance: DEPOSIT + RENT, chainNow: T0 + DAY, fetchedAt: 0,
    ...p,
  };
}
const ev = (name: string, args: Record<string, unknown>, timestamp = T0): TimelineEvent => ({ name, args, txHash: zeroHash as Hex, blockNumber: BigInt(1), logIndex: 0, timestamp });

describe("rental page banner: one honest action per role", () => {
  it("renter, month 1 funded: pay month 2 (jump to the two-step rent panel)", () => {
    const b = banner(lease(), "tenant", [], fmt, rentalCopy);
    expect(b.title).toBe("Your 200u deposit is locked in escrow.");
    expect(b.action).toMatchObject({ kind: "jump", to: "rent", label: "Pay month 2 · 100u" });
  });

  it("owner with a due month: collect it in one tx, the one-time fee taken from the first payout", () => {
    const b = banner(lease({ periodsDue: 2, periodsFunded: 2, chainNow: T0 + MONTH + DAY }), "landlord", [], fmt, rentalCopy);
    expect(b.action).toMatchObject({ kind: "tx", tx: "releaseRent", label: "Collect month 1 rent · 190u" });
    expect(b.body).toContain("10u");
  });

  it("owner with nothing due: idle until the next due date", () => {
    const b = banner(lease({ periodsReleased: 1, feeCharged: true }), "landlord", [ev("RentReleased", { toLandlord: BigInt(90_000_000) })], fmt, rentalCopy);
    expect(b.title).toBe("1 rent period paid: 90u is in your wallet.");
    expect(b.action.kind).toBe("idle");
  });

  it("reply window closed: the renter claims, the owner sees it closed, the desk has nothing to do", () => {
    const closed = lease({ status: LeaseStatus.MoveOut, timeoutAt: T0 + 10n * DAY, chainNow: T0 + 11n * DAY, proposal: { ...lease().proposal, proposer: RENTER, tenantRefund: DEPOSIT } });
    expect(banner(closed, "tenant", [], fmt, rentalCopy).action).toMatchObject({ kind: "tx", tx: "claimTimeout" });
    expect(banner(closed, "landlord", [], fmt, rentalCopy)).toMatchObject({ tone: "warn", action: { kind: "idle" } });
    expect(banner(closed, "arbiter", [], fmt, rentalCopy).action.kind).toBe("idle");
  });

  it("open proposal: the other side replies, the proposer waits", () => {
    const open = lease({ status: LeaseStatus.MoveOut, timeoutAt: T0 + 10n * DAY, chainNow: T0 + 9n * DAY, proposal: { ...lease().proposal, proposer: RENTER, tenantRefund: DEPOSIT } });
    expect(banner(open, "landlord", [], fmt, rentalCopy).action).toMatchObject({ kind: "jump", to: "return" });
    expect(banner(open, "tenant", [], fmt, rentalCopy).action.kind).toBe("idle");
  });

  it("dispute: the desk rules; after its deadline anyone in the rental returns the deposit", () => {
    const d = lease({ status: LeaseStatus.Disputed, arbiterDeadline: T0 + 20n * DAY, chainNow: T0 + 19n * DAY });
    expect(banner(d, "arbiter", [], fmt, rentalCopy).action).toMatchObject({ kind: "jump", to: "rule" });
    expect(banner({ ...d, chainNow: T0 + 21n * DAY }, "tenant", [], fmt, rentalCopy).action).toMatchObject({ kind: "tx", tx: "claimArbiterTimeout" });
    expect(banner({ ...d, chainNow: T0 + 21n * DAY }, null, [], fmt, rentalCopy).action.kind).toBe("idle");
  });

  it("not yet funded: the renter pays in deposit + month 1", () => {
    expect(banner(lease({ status: LeaseStatus.Created, startTime: BigInt(0) }), "tenant", [], fmt, rentalCopy).action).toMatchObject({ kind: "jump", to: "fund", label: "Pay in 300u" });
  });
});

describe("rental page in Chinese", () => {
  it("banner and return plan read Chinese; EN+中文 keeps English body with a bilingual title", () => {
    const zhCopy = rentalCopyFor(makeEnglishT(stateFor("zh")));
    const b = banner(lease(), "tenant", [], fmt, zhCopy);
    expect(b.title).toBe("你的 200u 押金已锁在托管合约中。");
    expect(b.body).toMatch(/\p{Script=Han}/u);
    expect(returnPlan(lease(), [], zhCopy).steps[0].title).toBe("还车照片");
    const both = banner(lease(), "tenant", [], fmt, rentalCopyFor(makeEnglishT(stateFor("both"))));
    expect(isValidElement(both.title)).toBe(true);
    expect(both.body).toBe(banner(lease(), "tenant", [], fmt, rentalCopy).body);
  });
});

describe("months, money and the return plan", () => {
  it("months: paid out, paid in, due with dates", () => {
    expect(monthCells(lease({ periodsReleased: 1, periodsFunded: 2 })).map((m) => m.state)).toEqual(["out", "in", "due"]);
    expect(monthCells(lease({ startTime: BigInt(0) }))).toEqual([]);
  });

  it("money flow from events", () => {
    const f = moneyFlow([
      ev("Funded", { deposit: DEPOSIT, firstRent: RENT }),
      ev("RentPaid", { amount: RENT }),
      ev("RentReleased", { toLandlord: BigInt(90_000_000) }),
      ev("ProtocolFeePaid", { amount: BigInt(10_000_000) }),
      ev("Settled", { tenantRefund: DEPOSIT, rentToTenant: BigInt(0), landlordClaim: BigInt(0), rentToLandlord: RENT, fee: BigInt(0) }),
    ]);
    expect(f).toEqual({ paidIn: DEPOSIT + 2n * RENT, toOwner: BigInt(190_000_000), fee: BigInt(10_000_000), backToRenter: DEPOSIT });
  });

  it("return plan: closed reply window, no dispute -> the deposit goes back now", () => {
    const l = lease({ status: LeaseStatus.MoveOut, timeoutAt: T0 + 10n * DAY, chainNow: T0 + 11n * DAY });
    const events = [ev("EvidenceAdded", { kind: 1 }, T0 + 2n * DAY), ev("SettlementProposed", {}, T0 + 3n * DAY)];
    expect(returnPlan(l, events, rentalCopy).steps.map((s) => s.state)).toEqual(["done", "done", "warn", "skip", "next"]);
  });

  it("return plan: settled after an owner timeout", () => {
    const l = lease({ status: LeaseStatus.Settled });
    const events = [ev("SettlementProposed", {}), ev("Settled", { basis: LANDLORD_TIMEOUT_BASIS }, T0 + 12n * DAY)];
    expect(returnPlan(l, events, rentalCopy).steps.map((s) => s.state)).toEqual(["todo", "done", "warn", "skip", "done"]);
  });
});

describe("renter card line", () => {
  const r = (p: Partial<RentalSummary>) => ({ status: LeaseStatus.Active, depositAmount: DEPOSIT, rentAmount: RENT, periodsFunded: 1, termPeriods: 3, rentPeriod: 30 * 86_400, returnPhotos: [], tenant: RENTER, responseWindow: 7 * 86_400, totals: { refunded: DEPOSIT }, ...p }) as unknown as RentalSummary;
  it("active: next month to pay", () => expect(renterLine(r({}), T0, fmt, renterCopy, true)).toEqual({ sentence: "Your 200u deposit is locked. Rent is paid for 1 of 3 rent periods.", action: "Pay month 2" }));
  it("weekly rent: the card speaks in weeks", () =>
    expect(renterLine(r({ rentPeriod: 7 * 86_400 }), T0, fmt, renterCopy, true)).toEqual({ sentence: "Your 200u deposit is locked. Rent is paid for 1 of 3 rent periods.", action: "Pay week 2" }));
  it("owner silent past the window: claim", () => {
    const p = { proposer: RENTER, tenantRefund: DEPOSIT, landlordClaim: BigInt(0), reportHash: zeroHash, proposedAt: T0, nonce: 1 };
    expect(renterLine(r({ status: LeaseStatus.MoveOut, proposal: p }), T0 + 8n * DAY, fmt, renterCopy, true).action).toBe("Claim deposit");
  });
});
