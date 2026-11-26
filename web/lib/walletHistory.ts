import { keccak256, toBytes, type Address, type Hex } from "viem";
import { formatToken } from "./actions/fields";
import { periodsDueAt, summarizeRentals, type ChainEvent, type RentalSummary } from "./rentals";

/**
 * A wallet's track record for the dispute desk (pure, tests/wallet-history.test.ts): folds the chain index's events
 * into exact counts for one wallet, as renter (tenant) and as owner (landlord). Every number comes from on-chain
 * events; the AI's own deposit proposal is the one exception, recorded by this server for verified rentals
 * (lib/server/history) and passed in as `aiClaims`. No names, no free text: only addresses, amounts and outcomes.
 */

export const LANDLORD_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.landlord-response"));
export const ARBITER_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.arbiter-deadline"));

export type Party = "renter" | "owner";

/** The AI inspection's proposal for one rental, as this server produced it (POST /api/settlement, verified rental). */
export type AiClaim = { reportHash: Hex; landlordClaim: string; deposit: string; mock: boolean; at: string };

export type DisputeFact = {
  lease: Address;
  /** The wallet's role in that rental. */
  as: Party;
  openedBy: Party;
  /** `ruled` by the dispute desk, `desk-late` (deadline missed: full deposit to the renter), or still `open`. */
  outcome: "open" | "ruled" | "desk-late";
  deposit: bigint;
  toRenter?: bigint;
  toOwner?: bigint;
  txHash: Hex;
};

export type ClaimFact = {
  lease: Address;
  as: Party;
  deposit: bigint;
  /** The owner's latest on-chain proposal: the part of the deposit they asked to keep, in basis points. */
  ownerClaimBps: number;
  /** What the AI inspection proposed for the same rental (basis points), when this server recorded it. */
  aiClaimBps?: number;
  aiMock?: boolean;
  txHash: Hex;
};

export type TimeoutFact = { lease: Address; as: Party; kind: "owner-silent" | "desk-late"; txHash: Hex };

export type WalletFacts = {
  address: Address;
  asRenter: { rentals: number; settled: number; disputes: number; rentOnTime: number; rentLate: number; rentUnpaid: number; depositSettled: bigint; depositBack: bigint };
  asOwner: { rentals: number; settled: number; disputes: number; depositSettled: bigint; depositKept: bigint; repliesMissed: number };
  disputes: DisputeFact[];
  claims: ClaimFact[];
  timeouts: TimeoutFact[];
};

const ZERO = BigInt(0);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const bps = (part: bigint, whole: bigint) => (whole > ZERO ? Number((part * BigInt(10_000)) / whole) : 0);

/** The AI claim backing one of the rental's on-chain proposals, else the newest one recorded. */
function aiClaimFor(r: RentalSummary, claims: AiClaim[] | undefined): AiClaim | undefined {
  if (!claims?.length) return undefined;
  const proposed = new Set(r.events.filter((e) => e.name === "SettlementProposed").map((e) => String(e.args.reportHash).toLowerCase()));
  return claims.find((c) => proposed.has(c.reportHash.toLowerCase())) ?? claims[claims.length - 1];
}

/** Rent periods funded before / after their due date, and periods due but never funded. */
function rentRecord(r: RentalSummary, now: bigint) {
  let onTime = 0;
  let late = 0;
  if (r.startTime === ZERO) return { onTime, late, unpaid: 0 };
  onTime = 1; // the first period is paid with the deposit at funding
  for (const e of r.events) {
    if (e.name !== "RentPaid") continue;
    const funded = Number(e.args.periodsFunded ?? 0);
    for (let k = funded - Number(e.args.periods ?? 0); k < funded; k++) {
      const due = r.startTime + BigInt(k * r.rentPeriod);
      if (e.timestamp > due) late++;
      else onTime++;
    }
  }
  const due = periodsDueAt(r.startTime, r.termPeriods, r.rentPeriod, r.moveOutAt || now);
  return { onTime, late, unpaid: Math.max(0, due - r.periodsFunded) };
}

/**
 * `events`: the chain index's events (every rental of the deployment); `now`: chain time; `aiClaims`: per rental
 * (lowercase address), the AI proposals this server recorded, oldest first.
 */
export function walletFacts(events: ChainEvent[], address: Address, now: bigint, aiClaims: Record<string, AiClaim[]> = {}): WalletFacts {
  const facts: WalletFacts = {
    address,
    asRenter: { rentals: 0, settled: 0, disputes: 0, rentOnTime: 0, rentLate: 0, rentUnpaid: 0, depositSettled: ZERO, depositBack: ZERO },
    asOwner: { rentals: 0, settled: 0, disputes: 0, depositSettled: ZERO, depositKept: ZERO, repliesMissed: 0 },
    disputes: [],
    claims: [],
    timeouts: [],
  };
  // Oldest first (by the LeaseCreated event's block), so the lists read as a history.
  const rentals = summarizeRentals(events, now).sort((a, b) => (a.events[0].blockNumber < b.events[0].blockNumber ? -1 : 1));
  for (const r of rentals) {
    const as: Party | null = same(r.tenant, address) ? "renter" : same(r.landlord, address) ? "owner" : null;
    // Unfunded offers and cancelled ones are not a track record.
    if (!as || r.startTime === ZERO) continue;
    const side = as === "renter" ? facts.asRenter : facts.asOwner;
    side.rentals++;
    const s = r.settled;
    if (s) {
      side.settled++;
      side.depositSettled += r.depositAmount;
      if (as === "renter") facts.asRenter.depositBack += s.tenantRefund;
      else facts.asOwner.depositKept += s.landlordClaim;
    }
    if (as === "renter") {
      const rent = rentRecord(r, now);
      facts.asRenter.rentOnTime += rent.onTime;
      facts.asRenter.rentLate += rent.late;
      facts.asRenter.rentUnpaid += rent.unpaid;
    }

    const raised = r.events.find((e) => e.name === "DisputeRaised");
    if (raised) {
      side.disputes++;
      const deskLate = s?.basis === ARBITER_TIMEOUT_BASIS;
      facts.disputes.push({
        lease: r.address,
        as,
        openedBy: same(String(raised.args.by), r.tenant) ? "renter" : "owner",
        outcome: !s ? "open" : deskLate ? "desk-late" : "ruled",
        deposit: r.depositAmount,
        ...(s ? { toRenter: s.tenantRefund, toOwner: s.landlordClaim } : {}),
        txHash: s?.txHash ?? raised.txHash,
      });
      if (deskLate) facts.timeouts.push({ lease: r.address, as, kind: "desk-late", txHash: s!.txHash });
    }
    if (s?.basis === LANDLORD_TIMEOUT_BASIS) {
      facts.timeouts.push({ lease: r.address, as, kind: "owner-silent", txHash: s.txHash });
      if (as === "owner") facts.asOwner.repliesMissed++;
    }

    const ownerProposal = r.events.findLast((e) => e.name === "SettlementProposed" && same(String(e.args.proposer), r.landlord));
    if (ownerProposal) {
      const ai = aiClaimFor(r, aiClaims[r.address.toLowerCase()]);
      facts.claims.push({
        lease: r.address,
        as,
        deposit: r.depositAmount,
        ownerClaimBps: bps(BigInt(ownerProposal.args.landlordClaim as bigint), r.depositAmount),
        ...(ai ? { aiClaimBps: bps(BigInt(ai.landlordClaim), BigInt(ai.deposit)), aiMock: ai.mock } : {}),
        txHash: ownerProposal.txHash,
      });
    }
  }
  return facts;
}

const pct = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The facts in plain English (the agent's answer and the API's `summary`): exact counts, no judgement. */
export function factsSummary(f: WalletFacts): string[] {
  const r = f.asRenter;
  const o = f.asOwner;
  const lines: string[] = [];
  if (r.rentals) {
    lines.push(
      `As renter: ${plural(r.rentals, "rental")}, ${r.settled} settled, ${plural(r.disputes, "dispute")}. Rent periods paid on time: ${r.rentOnTime}, late: ${r.rentLate}, due but unpaid: ${r.rentUnpaid}.` +
        (r.depositSettled > ZERO ? ` Got back ${formatToken(r.depositBack)} of ${formatToken(r.depositSettled)} in settled deposits (${pct(bps(r.depositBack, r.depositSettled))}).` : ""),
    );
  }
  if (o.rentals) {
    lines.push(
      `As owner: ${plural(o.rentals, "rental")}, ${o.settled} settled, ${plural(o.disputes, "dispute")}. Kept ${formatToken(o.depositKept)} of ${formatToken(o.depositSettled)} in settled deposits for damage. Missed the reply window ${plural(o.repliesMissed, "time")}.`,
    );
  }
  if (!lines.length) lines.push("No funded rentals on this deployment yet.");
  for (const d of f.disputes) {
    const who = d.openedBy === "renter" ? "the renter" : "the owner";
    const out =
      d.outcome === "open"
        ? "still open"
        : d.outcome === "desk-late"
          ? `the dispute desk missed its deadline, so the full deposit (${formatToken(d.deposit)}) went back to the renter`
          : `the dispute desk ruled ${formatToken(d.toRenter!)} to the renter, ${formatToken(d.toOwner!)} to the owner`;
    lines.push(`Dispute on rental ${d.lease} (as ${d.as}), opened by ${who}: ${out}.`);
  }
  for (const c of f.claims) {
    const ai = c.aiClaimBps === undefined ? "no AI proposal recorded" : `the ${c.aiMock ? "demo inspector" : "AI inspection"} proposed ${pct(c.aiClaimBps)}`;
    lines.push(`Rental ${c.lease} (as ${c.as}): the owner claimed ${pct(c.ownerClaimBps)} of the deposit; ${ai}.`);
  }
  return lines;
}

/**
 * One factual sentence for `party` about a settled rental (the Living Brain capture, lib/server/history): outcome,
 * amounts, rental and transaction. Never free text from a person, never an opinion about them.
 */
export function settledSentence(r: RentalSummary, party: Party): string | null {
  const s = r.settled;
  if (!s) return null;
  const raised = r.events.find((e) => e.name === "DisputeRaised");
  const how =
    s.basis === LANDLORD_TIMEOUT_BASIS
      ? "the owner did not answer the renter's return proposal in time, so the full deposit went back to the renter"
      : s.basis === ARBITER_TIMEOUT_BASIS
        ? "the dispute desk missed its deadline, so the full deposit went back to the renter"
        : raised
          ? `dispute opened by the ${same(String(raised.args.by), r.tenant) ? "renter" : "owner"}, ruled by the dispute desk`
          : "settled by agreement";
  const split = `${formatToken(s.tenantRefund)} of the ${formatToken(r.depositAmount)} deposit back to the renter, ${formatToken(s.landlordClaim)} kept by the owner`;
  const who = party === "renter" ? r.tenant : r.landlord;
  return `Wallet ${who} was the ${party} of KeyScrow rental ${r.address}: ${how}; ${split}. Transaction ${s.txHash}.`;
}
