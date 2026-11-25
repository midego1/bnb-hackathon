import type { Address, Hex } from "viem";
import { LeaseStatus } from "./contracts";
import type { T } from "./i18n/t";

/**
 * Pure model behind the back office, fleet owner and renter views: folds raw chain events (factory LeaseCreated /
 * PayeeSet and every RentalEscrow event) into one summary per rental, with flags for anything stuck, failed or
 * disputed. No I/O here, so it is unit-tested in tests/rentals.test.ts.
 */

export type ChainEvent = {
  /** Contract that emitted it (factory, an escrow, the vault or the token). */
  address: Address;
  name: string;
  args: Record<string, unknown>;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  /** Block time, when known (0 otherwise). */
  timestamp: bigint;
};

export type FlagLevel = "danger" | "warn" | "info";
/** `text` is the English sentence (API, agent); the UI renders `code` + `vars` from the dictionary (roles.flag). */
export type RentalFlag = { level: FlagLevel; code: string; text: string; vars?: Record<string, number> };

export type RentalSummary = {
  address: Address;
  landlord: Address;
  tenant: Address;
  arbiter: Address;
  /** Where the owner's payouts go: the owner, or the Fleet Vault. */
  payee: Address;
  rentAmount: bigint;
  depositAmount: bigint;
  termMonths: number;
  responseWindow: number;
  arbiterWindow: number;
  leaseHash: Hex;
  status: LeaseStatus;
  createdAt: bigint;
  createdTx: Hex;
  startTime: bigint;
  monthsFunded: number;
  monthsReleased: number;
  pickupPhotos: Hex[];
  returnPhotos: Hex[];
  /** Latest return (deposit-split) proposal; `reportHash` is the AI inspection report it is based on. */
  proposal?: { proposer: Address; tenantRefund: bigint; landlordClaim: bigint; reportHash: Hex; proposedAt: bigint; nonce: number };
  disputedAt: bigint;
  settled?: { tenantRefund: bigint; landlordClaim: bigint; rentToLandlord: bigint; rentToTenant: bigint; fee: bigint; basis: Hex; at: bigint; txHash: Hex };
  /** Money totals so far, in token base units. */
  totals: {
    /** Deposit currently locked in the escrow. */
    depositLocked: bigint;
    /** Rent paid into the escrow (first month + prepaid months). */
    rentPaidIn: bigint;
    /** Net rent paid out to the owner / vault (after the one-time fee). */
    rentToOwner: bigint;
    fees: bigint;
    /** Deposit kept by the owner / vault for damage. */
    slashed: bigint;
    /** Deposit + unused rent returned to the renter. */
    refunded: bigint;
  };
  events: ChainEvent[];
  flags: RentalFlag[];
};

export const RENT_PERIOD = 30 * 86_400;
/** An offer nobody funded for this long is flagged as stuck. */
export const STALE_OFFER_SECONDS = 2 * 86_400;

const big = (v: unknown) => (typeof v === "bigint" ? v : BigInt((v as number | string | undefined) ?? 0));
const num = (v: unknown) => Number(v ?? 0);

function sortEvents(a: ChainEvent, b: ChainEvent) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Rent months that are due at `now` (same rule as RentalEscrow.monthsDue). */
export function monthsDueAt(startTime: bigint, termMonths: number, now: bigint): number {
  if (startTime === BigInt(0)) return 0;
  const due = Number((now - startTime) / BigInt(RENT_PERIOD)) + 1;
  return Math.min(due, termMonths);
}

/**
 * Folds `events` (any order, any contracts) into one summary per LeaseCreated rental, newest first.
 * `failedTx` maps escrow address (lowercase) -> reverted transaction hashes, when the caller scanned for them.
 */
export function summarizeRentals(events: ChainEvent[], now: bigint, failedTx: Map<string, Hex[]> = new Map()): RentalSummary[] {
  const sorted = [...events].sort(sortEvents);
  const byLease = new Map<string, RentalSummary>();
  const payees = new Map<string, Address>();
  for (const e of sorted) if (e.name === "PayeeSet") payees.set(String(e.args.escrow).toLowerCase(), e.args.payee as Address);

  for (const e of sorted) {
    if (e.name !== "LeaseCreated") continue;
    const a = e.args;
    const address = a.escrow as Address;
    byLease.set(address.toLowerCase(), {
      address,
      landlord: a.landlord as Address,
      tenant: a.tenant as Address,
      arbiter: a.arbiter as Address,
      payee: payees.get(address.toLowerCase()) ?? (a.landlord as Address),
      rentAmount: big(a.rentAmount),
      depositAmount: big(a.depositAmount),
      termMonths: num(a.termMonths),
      responseWindow: num(a.responseWindow),
      arbiterWindow: num(a.arbiterWindow),
      leaseHash: a.leaseHash as Hex,
      status: LeaseStatus.Created,
      createdAt: e.timestamp,
      createdTx: e.txHash,
      startTime: BigInt(0),
      monthsFunded: 0,
      monthsReleased: 0,
      pickupPhotos: [],
      returnPhotos: [],
      disputedAt: BigInt(0),
      totals: { depositLocked: BigInt(0), rentPaidIn: BigInt(0), rentToOwner: BigInt(0), fees: BigInt(0), slashed: BigInt(0), refunded: BigInt(0) },
      events: [e],
      flags: [],
    });
  }

  for (const e of sorted) {
    const r = byLease.get(e.address.toLowerCase());
    if (!r) continue;
    r.events.push(e);
    const a = e.args;
    switch (e.name) {
      case "Funded":
        r.status = LeaseStatus.Active;
        r.startTime = big(a.startTime) || e.timestamp;
        r.monthsFunded = 1;
        r.totals.depositLocked = big(a.deposit);
        r.totals.rentPaidIn += big(a.firstRent);
        break;
      case "RentPaid":
        r.monthsFunded = num(a.monthsFunded);
        r.totals.rentPaidIn += big(a.amount);
        break;
      case "RentReleased":
        r.monthsReleased += num(a.months);
        r.totals.rentToOwner += big(a.toLandlord);
        r.totals.fees += big(a.fee);
        break;
      case "EvidenceAdded":
        if (num(a.kind) === 0) r.pickupPhotos.push(a.contentHash as Hex);
        else if (num(a.kind) === 1) r.returnPhotos.push(a.contentHash as Hex);
        break;
      case "SettlementProposed":
        r.status = LeaseStatus.MoveOut;
        r.proposal = {
          proposer: a.proposer as Address,
          tenantRefund: big(a.tenantRefund),
          landlordClaim: big(a.landlordClaim),
          reportHash: a.reportHash as Hex,
          proposedAt: e.timestamp,
          nonce: num(a.nonce),
        };
        break;
      case "DisputeRaised":
        r.status = LeaseStatus.Disputed;
        r.disputedAt = e.timestamp;
        break;
      case "Settled": {
        r.status = LeaseStatus.Settled;
        const s = {
          tenantRefund: big(a.tenantRefund),
          landlordClaim: big(a.landlordClaim),
          rentToLandlord: big(a.rentToLandlord),
          rentToTenant: big(a.rentToTenant),
          fee: big(a.fee),
          basis: a.basis as Hex,
          at: e.timestamp,
          txHash: e.txHash,
        };
        r.settled = s;
        r.monthsReleased = r.monthsFunded - Number(s.rentToTenant / (r.rentAmount || BigInt(1)));
        r.totals.depositLocked = BigInt(0);
        r.totals.rentToOwner += s.rentToLandlord - s.fee;
        r.totals.fees += s.fee;
        r.totals.slashed += s.landlordClaim;
        r.totals.refunded += s.tenantRefund + s.rentToTenant;
        break;
      }
      case "Cancelled":
        r.status = LeaseStatus.Cancelled;
        break;
    }
  }

  const out = [...byLease.values()];
  for (const r of out) r.flags = flagsFor(r, now, failedTx.get(r.address.toLowerCase()) ?? []);
  return out.sort((x, y) => (x.createdAt === y.createdAt ? 0 : x.createdAt > y.createdAt ? -1 : 1));
}

function days(seconds: bigint | number) {
  const d = Number(seconds) / 86_400;
  return d >= 1 ? `${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"}` : `${Math.max(1, Math.round(Number(seconds) / 3600))} h`;
}

export function flagsFor(r: RentalSummary, now: bigint, failed: Hex[] = []): RentalFlag[] {
  const flags: RentalFlag[] = [];
  if (failed.length > 0) {
    flags.push({ level: "danger", code: "failed-tx", text: `${failed.length} failed transaction${failed.length > 1 ? "s" : ""} on this rental`, vars: { n: failed.length } });
  }
  const open = r.status === LeaseStatus.Active || r.status === LeaseStatus.MoveOut || r.status === LeaseStatus.Disputed;
  if (r.status === LeaseStatus.Disputed) {
    const deadline = r.disputedAt + BigInt(r.arbiterWindow);
    flags.push(
      now >= deadline
        ? { level: "danger", code: "arbiter-overdue", text: "Dispute desk missed its deadline: anyone can close it (full deposit to the renter)" }
        : { level: "danger", code: "disputed", text: `In dispute: the dispute desk must rule within ${days(deadline - now)}`, vars: { secs: Number(deadline - now) } },
    );
  }
  if (r.status === LeaseStatus.MoveOut && r.proposal) {
    const deadline = r.proposal.proposedAt + BigInt(r.responseWindow);
    const byRenter = r.proposal.proposer.toLowerCase() === r.tenant.toLowerCase();
    if (byRenter && now >= deadline) {
      flags.push({ level: "warn", code: "owner-silent", text: "Owner did not answer the return proposal in time: timeout claimable" });
    } else {
      flags.push({ level: "info", code: "proposal-open", text: `Return proposal waiting for the ${byRenter ? "owner" : "renter"}`, vars: { byRenter: byRenter ? 1 : 0 } });
    }
  }
  if (r.status === LeaseStatus.Created && r.createdAt > BigInt(0) && now - r.createdAt >= BigInt(STALE_OFFER_SECONDS)) {
    flags.push({ level: "warn", code: "unfunded", text: `Offer not funded for ${days(now - r.createdAt)}`, vars: { secs: Number(now - r.createdAt) } });
  }
  if (open) {
    const due = Math.min(monthsDueAt(r.startTime, r.termMonths, now), r.monthsFunded);
    if (due > r.monthsReleased) {
      flags.push({ level: "warn", code: "rent-due", text: `${due - r.monthsReleased} month${due - r.monthsReleased > 1 ? "s" : ""} of rent due, not paid out yet`, vars: { n: due - r.monthsReleased } });
    }
    const end = r.startTime + BigInt(r.termMonths * RENT_PERIOD);
    if (r.startTime > BigInt(0) && now >= end) flags.push({ level: "warn", code: "overdue-return", text: "Rental period over, deposit not settled yet" });
  }
  return flags;
}

/** Worst flag level of a rental, for sorting and badges. */
export function worstFlag(flags: RentalFlag[]): FlagLevel | undefined {
  if (flags.some((f) => f.level === "danger")) return "danger";
  if (flags.some((f) => f.level === "warn")) return "warn";
  return flags.length ? "info" : undefined;
}

/** Human label of one chain event, for the back office feed, in the active language (roles.event). */
export function describeEvent(e: ChainEvent, money: (v: bigint) => string, t: T): string {
  const a = e.args;
  const m = (v: unknown) => money(big(v));
  switch (e.name) {
    case "LeaseCreated":
      return t("roles.event.LeaseCreated", { rent: m(a.rentAmount), deposit: m(a.depositAmount), n: num(a.termMonths) });
    case "Funded":
      return t("roles.event.Funded", { deposit: m(a.deposit), rent: m(a.firstRent) });
    case "RentPaid":
      return t("roles.event.RentPaid", { n: num(a.months), amount: m(a.amount) });
    case "RentReleased":
      return big(a.fee) > BigInt(0)
        ? t("roles.event.RentReleasedFee", { amount: m(a.toLandlord), fee: m(a.fee) })
        : t("roles.event.RentReleased", { amount: m(a.toLandlord) });
    case "EvidenceAdded":
      return t(num(a.kind) === 0 ? "roles.event.pickupPhoto" : num(a.kind) === 1 ? "roles.event.returnPhoto" : "roles.event.evidence");
    case "SettlementProposed":
      return t("roles.event.SettlementProposed", { back: m(a.tenantRefund), kept: m(a.landlordClaim) });
    case "Settled":
      return big(a.landlordClaim) > BigInt(0)
        ? t("roles.event.SettledSlashed", { kept: m(a.landlordClaim), back: m(a.tenantRefund) })
        : t("roles.event.SettledFull", { back: m(a.tenantRefund) });
    case "ProtocolFeePaid":
    case "Deposited":
    case "Claimed":
      return t(`roles.event.${e.name}`, { amount: m(a.amount) });
    case "Redeemed":
      return t("roles.event.Redeemed", { amount: m(a.shares) });
    case "IncomeDistributed":
      return t("roles.event.IncomeDistributed", { holders: m(a.toShareholders), fee: m(a.operatorFee) });
    case "Transfer":
      return t("roles.event.Transfer", { amount: m(a.value) });
    case "PayeeSet":
    case "DisputeRaised":
    case "Cancelled":
      return t(`roles.event.${e.name}`);
    default:
      return e.name;
  }
}
