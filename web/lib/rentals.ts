import type { Address, Hex } from "viem";
import { LeaseStatus } from "./contracts";

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
export type RentalFlag = { level: FlagLevel; code: string; text: string };

export type RentalSummary = {
  address: Address;
  landlord: Address;
  tenant: Address;
  arbiter: Address;
  /** Where the owner's payouts go: the owner, or the Fleet Vault. */
  payee: Address;
  rentAmount: bigint;
  depositAmount: bigint;
  termPeriods: number;
  /** Seconds per rent period: 7, 14 or 30 days. */
  rentPeriod: number;
  responseWindow: number;
  arbiterWindow: number;
  leaseHash: Hex;
  status: LeaseStatus;
  createdAt: bigint;
  createdTx: Hex;
  startTime: bigint;
  periodsFunded: number;
  periodsReleased: number;
  pickupPhotos: Hex[];
  returnPhotos: Hex[];
  /** Latest return (deposit-split) proposal; `reportHash` is the AI inspection report it is based on. */
  proposal?: { proposer: Address; tenantRefund: bigint; landlordClaim: bigint; reportHash: Hex; proposedAt: bigint; nonce: number };
  disputedAt: bigint;
  /** When the move-out started (first proposal or dispute): the contract's rent clock stops here. 0 while active. */
  moveOutAt: bigint;
  settled?: { tenantRefund: bigint; landlordClaim: bigint; rentToLandlord: bigint; rentToTenant: bigint; fee: bigint; basis: Hex; at: bigint; txHash: Hex };
  /** Money totals so far, in token base units. */
  totals: {
    /** Deposit currently locked in the escrow. */
    depositLocked: bigint;
    /** Rent paid into the escrow (first period + prepaid periods). */
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

const DAY = 86_400;
/** Rent periods a rental can use (EscrowFactory): weekly, every two weeks, monthly (the default). */
export const RENT_PERIODS = [7 * DAY, 14 * DAY, 30 * DAY] as const;
export const DEFAULT_RENT_PERIOD = 30 * DAY;
const MONTH = 30 * DAY;

/** "week", "2 weeks", "month": the unit after "rent per". */
export function periodName(rentPeriod: number): string {
  if (rentPeriod === MONTH) return "month";
  if (rentPeriod === 7 * DAY) return "week";
  return rentPeriod % (7 * DAY) === 0 ? `${rentPeriod / (7 * DAY)} weeks` : `${rentPeriod / DAY} days`;
}

/** `n` rent periods in words: "3 months", "1 week", "6 weeks" (3 periods of 2 weeks). */
export function periodCount(n: number, rentPeriod: number): string {
  const [k, unit] = rentPeriod % MONTH === 0 ? [(n * rentPeriod) / MONTH, "month"] : rentPeriod % (7 * DAY) === 0 ? [(n * rentPeriod) / (7 * DAY), "week"] : [(n * rentPeriod) / DAY, "day"];
  return `${k} ${unit}${k === 1 ? "" : "s"}`;
}

/** Rent per period from a monthly price: monthly x days / 30, rounded down to token units. */
export function rentPerPeriod(monthly: bigint, rentPeriod: number): bigint {
  return (monthly * BigInt(rentPeriod)) / BigInt(MONTH);
}

/** The one-time KeyEscrow fee: `feeBps` of the monthly-equivalent rent (rent x 30 days / period), rounded down. */
export function oneTimeFee(rentAmount: bigint, rentPeriod: number, feeBps: number): bigint {
  return (rentAmount * BigInt(MONTH) * BigInt(feeBps)) / (BigInt(rentPeriod) * BigInt(10_000));
}
/** An offer nobody funded for this long is flagged as stuck. */
export const STALE_OFFER_SECONDS = 2 * 86_400;

const big = (v: unknown) => (typeof v === "bigint" ? v : BigInt((v as number | string | undefined) ?? 0));
const num = (v: unknown) => Number(v ?? 0);

function sortEvents(a: ChainEvent, b: ChainEvent) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Rent periods that are due at `now` (same rule as RentalEscrow.periodsDue; pass `moveOutAt` once it is set). */
export function periodsDueAt(startTime: bigint, termPeriods: number, rentPeriod: number, now: bigint): number {
  if (startTime === BigInt(0)) return 0;
  const due = Number((now - startTime) / BigInt(rentPeriod)) + 1;
  return Math.min(due, termPeriods);
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
      termPeriods: num(a.termPeriods),
      rentPeriod: num(a.rentPeriod) || DEFAULT_RENT_PERIOD,
      responseWindow: num(a.responseWindow),
      arbiterWindow: num(a.arbiterWindow),
      leaseHash: a.leaseHash as Hex,
      status: LeaseStatus.Created,
      createdAt: e.timestamp,
      createdTx: e.txHash,
      startTime: BigInt(0),
      periodsFunded: 0,
      periodsReleased: 0,
      pickupPhotos: [],
      returnPhotos: [],
      disputedAt: BigInt(0),
      moveOutAt: BigInt(0),
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
        r.periodsFunded = 1;
        r.totals.depositLocked = big(a.deposit);
        r.totals.rentPaidIn += big(a.firstRent);
        break;
      case "RentPaid":
        r.periodsFunded = num(a.periodsFunded);
        r.totals.rentPaidIn += big(a.amount);
        break;
      case "RentReleased":
        r.periodsReleased += num(a.periods);
        r.totals.rentToOwner += big(a.toLandlord);
        r.totals.fees += big(a.fee);
        break;
      case "EvidenceAdded":
        if (num(a.kind) === 0) r.pickupPhotos.push(a.contentHash as Hex);
        else if (num(a.kind) === 1) r.returnPhotos.push(a.contentHash as Hex);
        break;
      case "SettlementProposed":
        if (r.status === LeaseStatus.Active) r.moveOutAt = e.timestamp;
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
        if (r.status === LeaseStatus.Active) r.moveOutAt = e.timestamp;
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
        r.periodsReleased = r.periodsFunded - Number(s.rentToTenant / (r.rentAmount || BigInt(1)));
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
    flags.push({ level: "danger", code: "failed-tx", text: `${failed.length} failed transaction${failed.length > 1 ? "s" : ""} on this rental` });
  }
  const open = r.status === LeaseStatus.Active || r.status === LeaseStatus.MoveOut || r.status === LeaseStatus.Disputed;
  if (r.status === LeaseStatus.Disputed) {
    const deadline = r.disputedAt + BigInt(r.arbiterWindow);
    flags.push(
      now >= deadline
        ? { level: "danger", code: "arbiter-overdue", text: "Dispute desk missed its deadline: anyone can close it (full deposit to the renter)" }
        : { level: "danger", code: "disputed", text: `In dispute: the dispute desk must rule within ${days(deadline - now)}` },
    );
  }
  if (r.status === LeaseStatus.MoveOut && r.proposal) {
    const deadline = r.proposal.proposedAt + BigInt(r.responseWindow);
    const byRenter = r.proposal.proposer.toLowerCase() === r.tenant.toLowerCase();
    if (byRenter && now >= deadline) {
      flags.push({ level: "warn", code: "owner-silent", text: "Owner did not answer the return proposal in time: timeout claimable" });
    } else {
      flags.push({ level: "info", code: "proposal-open", text: `Return proposal waiting for the ${byRenter ? "owner" : "renter"}` });
    }
  }
  if (r.status === LeaseStatus.Created && r.createdAt > BigInt(0) && now - r.createdAt >= BigInt(STALE_OFFER_SECONDS)) {
    flags.push({ level: "warn", code: "unfunded", text: `Offer not funded for ${days(now - r.createdAt)}` });
  }
  if (open) {
    const due = Math.min(periodsDueAt(r.startTime, r.termPeriods, r.rentPeriod, r.moveOutAt || now), r.periodsFunded);
    if (due > r.periodsReleased) {
      flags.push({ level: "warn", code: "rent-due", text: `${periodCount(due - r.periodsReleased, r.rentPeriod)} of rent due, not paid out yet` });
    }
    const end = r.startTime + BigInt(r.termPeriods * r.rentPeriod);
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

/** Human label of one chain event, for activity feeds. `role(address)` names a party. */
export function describeEvent(e: ChainEvent, money: (v: bigint) => string): string {
  const a = e.args;
  switch (e.name) {
    case "LeaseCreated":
      return `Rental created: ${money(big(a.rentAmount))}/${periodName(num(a.rentPeriod) || DEFAULT_RENT_PERIOD)}, ${money(big(a.depositAmount))} deposit, ${periodCount(num(a.termPeriods), num(a.rentPeriod) || DEFAULT_RENT_PERIOD)}`;
    case "PayeeSet":
      return "Owner payouts routed to the Fleet Vault";
    case "Funded":
      return `Deposit locked (${money(big(a.deposit))}) + first rent paid (${money(big(a.firstRent))})`;
    case "RentPaid":
      return `Renter prepaid ${num(a.periods)} rent period(s): ${money(big(a.amount))}`;
    case "RentReleased":
      return `Rent paid out: ${money(big(a.toLandlord))} to the owner${big(a.fee) > BigInt(0) ? ` + ${money(big(a.fee))} KeyEscrow fee` : ""}`;
    case "EvidenceAdded":
      return num(a.kind) === 0 ? "Pickup inspection photo anchored" : num(a.kind) === 1 ? "Return inspection photo anchored" : "Evidence anchored";
    case "SettlementProposed":
      return `AI verdict proposed: ${money(big(a.tenantRefund))} back to the renter, ${money(big(a.landlordClaim))} for damage`;
    case "DisputeRaised":
      return "Dispute raised: the dispute desk decides";
    case "Settled":
      return big(a.landlordClaim) > BigInt(0)
        ? `Settled: deposit slashed ${money(big(a.landlordClaim))}, ${money(big(a.tenantRefund))} returned`
        : `Settled: full deposit returned (${money(big(a.tenantRefund))})`;
    case "Cancelled":
      return "Offer cancelled by the owner";
    case "ProtocolFeePaid":
      return `KeyEscrow fee paid: ${money(big(a.amount))}`;
    case "Deposited":
      return `Shareholder deposited ${money(big(a.amount))} (shares minted)`;
    case "Redeemed":
      return `Shareholder redeemed ${money(big(a.shares))}`;
    case "IncomeDistributed":
      return `Vault income split: ${money(big(a.toShareholders))} to shareholders, ${money(big(a.operatorFee))} operator fee`;
    case "Claimed":
      return `Shareholder claimed ${money(big(a.amount))} income`;
    case "Transfer":
      return `Vault inflow: ${money(big(a.value))}`;
    default:
      return e.name;
  }
}
