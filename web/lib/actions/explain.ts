/**
 * explain_status: where the deposit is, what can happen next, and who must act by when, in plain language.
 * Pure function of a lease snapshot (chain time, not wall-clock, so anvil time jumps are respected).
 */
import type { Address } from "viem";
import { formatToken } from "./fields";
import { isoTime, roleOf, type LeaseSnapshot, type Role } from "./lease";
import { periodCount, periodName } from "../rentals";

export type NextStep = {
  who: Role;
  /** The prepare_* action that does it. */
  action: string;
  what: string;
  /** ISO time by which (or from which, see `when`) this applies. */
  deadline?: string;
  when?: "before" | "from";
};

export type Explanation = {
  status: LeaseSnapshot["status"];
  you: Role | "not a party" | null;
  headline: string;
  deposit: { amount: string; where: string };
  rent: string;
  next: NextStep[];
  text: string;
};

const who: Record<Role, string> = { owner: "the owner", renter: "the renter", arbiter: "the dispute desk", anyone: "anyone" };

function human(s: bigint, now: bigint): string {
  const d = Number(s - now);
  const abs = Math.abs(d);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const span = days > 0 ? `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} h` : ""}` : `${Math.max(1, Math.round(abs / 60))} min`;
  return `${isoTime(s).replace("T", " ").slice(0, 16)} UTC (${d >= 0 ? `in ${span}` : `${span} ago`})`;
}

export function explainLease(l: LeaseSnapshot, viewer?: Address): Explanation {
  const deposit = formatToken(l.terms.depositAmount);
  const role = viewer ? (roleOf(l, viewer) ?? "not a party") : null;
  const p = l.proposal;
  const proposer = p.nonce > 0 ? roleOf(l, p.proposer) : null;
  const next: NextStep[] = [];
  let headline: string;
  let where: string;

  const rentLeft = l.periodsFunded - l.periodsReleased;
  const releasable = Math.max(0, Math.min(l.periodsDue, l.periodsFunded) - l.periodsReleased);
  const per = periodName(l.terms.rentPeriod);
  const rent =
    l.startTime === BigInt(0)
      ? `Rent ${formatToken(l.terms.rentAmount)} per ${per} for ${periodCount(l.terms.termPeriods, l.terms.rentPeriod)}; nothing paid yet.`
      : `Rent ${formatToken(l.terms.rentAmount)} per ${per}: ${l.periodsFunded} of ${l.terms.termPeriods} rent periods paid into escrow, ${l.periodsReleased} paid out to the owner, ${rentLeft} still held.` +
        (releasable > 0 ? ` ${periodCount(releasable, l.terms.rentPeriod)} of rent ${releasable > 1 ? "are" : "is"} due and can be paid out now.` : "");

  switch (l.status) {
    case "Created":
      headline = "Offer made, waiting for the renter to fund it.";
      where = `Not paid yet. The renter pays the ${deposit} deposit plus the first ${per}'s rent into the escrow contract.`;
      next.push({ who: "renter", action: "prepare_fund", what: `Approve and pay ${formatToken(l.terms.depositAmount + l.terms.rentAmount)} (deposit + the first ${per}) to start the rental.` });
      next.push({ who: "owner", action: "prepare_cancel", what: "The owner can withdraw the offer while it is unfunded." });
      break;
    case "Active":
      headline = "Rental running.";
      where = `Held in the escrow contract ${l.address}. Neither side can take it alone: it only moves on agreement, a dispute-desk ruling or a timeout.`;
      if (releasable > 0) next.push({ who: "anyone", action: "prepare_release_rent", what: `Pay ${periodCount(releasable, l.terms.rentPeriod)} of due rent out to the owner.` });
      next.push({ who: "renter", action: "prepare_propose_settlement", what: "At return, propose how the deposit is split (e.g. from the AI inspection)." });
      next.push({ who: "owner", action: "prepare_propose_settlement", what: "Or the owner proposes the split first." });
      next.push({ who: "renter", action: "prepare_dispute", what: "Either side can ask the dispute desk to decide." });
      break;
    case "MoveOut": {
      const split = `${formatToken(p.tenantRefund)} back to the renter, ${formatToken(p.landlordClaim)} to the owner`;
      headline = `Return in progress: ${who[proposer ?? "anyone"]} proposed ${split} (proposal #${p.nonce}).`;
      where = `Still held in escrow ${l.address} until the proposal is accepted, countered, disputed or times out.`;
      const counter: Role = proposer === "owner" ? "renter" : "owner";
      next.push({ who: counter, action: "prepare_accept", what: `Accept proposal #${p.nonce}: pays out immediately (${split}).` });
      next.push({ who: counter, action: "prepare_propose_settlement", what: "Counter with a different split (restarts the clock)." });
      next.push({ who: counter, action: "prepare_dispute", what: "Send it to the dispute desk." });
      if (l.timeoutAt > BigInt(0)) {
        const passed = l.chainNow >= l.timeoutAt;
        next.push(
          passed
            ? { who: "anyone", action: "prepare_claim_timeout", what: `The owner did not answer in time: return the FULL ${deposit} deposit to the renter.`, deadline: isoTime(l.timeoutAt), when: "from" }
            : { who: "owner", action: "prepare_accept", what: `The owner must answer by ${human(l.timeoutAt, l.chainNow)}, or the full deposit goes back to the renter.`, deadline: isoTime(l.timeoutAt), when: "before" },
        );
      }
      break;
    }
    case "Disputed": {
      const passed = l.chainNow >= l.arbiterDeadline;
      headline = passed ? "In dispute, and the dispute desk missed its deadline." : "In dispute: waiting for the dispute desk to rule.";
      where = `Held in escrow ${l.address}; frozen until the dispute desk rules or its deadline passes.`;
      next.push(
        passed
          ? { who: "anyone", action: "prepare_claim_timeout", what: `Deadline passed: return the FULL ${deposit} deposit to the renter.`, deadline: isoTime(l.arbiterDeadline), when: "from" }
          : { who: "arbiter", action: "prepare_resolve", what: `The dispute desk must rule on the split by ${human(l.arbiterDeadline, l.chainNow)}; after that the full deposit can go back to the renter.`, deadline: isoTime(l.arbiterDeadline), when: "before" },
      );
      break;
    }
    case "Settled":
      headline = "Closed. Deposit and rent fully paid out.";
      where = `Paid out: nothing is left in escrow (balance ${formatToken(l.balance)}).${p.nonce > 0 ? ` The last proposal was ${formatToken(p.tenantRefund)} to the renter, ${formatToken(p.landlordClaim)} to the owner (the final split may differ if a timeout or the dispute desk decided).` : ""}`;
      break;
    case "Cancelled":
      headline = "Offer withdrawn before it was funded.";
      where = "No deposit was ever paid.";
      break;
  }

  const youLine =
    role === null ? "" : role === "not a party" ? "You are not a party to this rental. " : `You are ${who[role]}. `;
  const yours = role && role !== "not a party" ? next.filter((n) => n.who === role || n.who === "anyone") : [];
  const nextText = next.length
    ? `What can happen next:\n${next.map((n) => `- ${who[n.who]}: ${n.what} [${n.action}]`).join("\n")}`
    : "Nothing else can happen: the rental is closed.";
  const text = [
    `${youLine}${headline}`,
    `Deposit (${deposit}): ${where}`,
    rent,
    nextText,
    yours.length ? `Your options: ${yours.map((n) => n.action).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { status: l.status, you: role, headline, deposit: { amount: deposit, where }, rent, next, text };
}
