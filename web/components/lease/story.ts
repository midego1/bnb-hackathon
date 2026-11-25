import { keccak256, toBytes, zeroHash, type Address } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import type { RentalSummary } from "@/lib/rentals";
import { responseWindow } from "@/lib/windows";
import type { RentalCopy } from "./copy";
import { RENT_PERIOD, releasableMonths, roleName, viewerRole, type Viewer } from "./model";

/**
 * The rental page as plain sentences (pure, tests/lease-story.test.ts): what state it is in, the ONE thing the viewer
 * can do about it, the month-by-month progress, where the money is, and what happens at return. Everything comes from
 * the escrow's own state and events; `fmt` formats a token amount (baht first).
 */

export const LANDLORD_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.landlord-response"));
export const ARBITER_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.arbiter-deadline"));

type Fmt = (v: bigint) => string;
const ZERO = BigInt(0);
const big = (v: unknown) => (typeof v === "bigint" ? v : BigInt((v as number | undefined) ?? 0));

/** "jump" scrolls to the panel that does a multi-step action; "tx" is one wallet confirmation right in the banner. */
export type BannerAction =
  | { kind: "tx"; tx: "releaseRent" | "claimTimeout" | "claimArbiterTimeout"; label: string; note: string }
  | { kind: "jump"; to: "fund" | "rent" | "return" | "rule"; label: string; note?: string }
  | { kind: "idle"; label: string };

export type Banner = { tone: "ok" | "warn" | "danger" | "neutral"; pill: string; title: string; body: string; action: BannerAction };

export const feeOf = (lease: Pick<LeaseData, "terms">) => (lease.terms.rentAmount * BigInt(lease.terms.feeBps)) / BigInt(10_000);
const returnAt = (lease: LeaseData) => lease.startTime + BigInt(lease.terms.termMonths) * RENT_PERIOD;

/** Money that moved, from the escrow's events (the escrow balance itself is read live). */
export function moneyFlow(events: TimelineEvent[] = []) {
  let paidIn = ZERO;
  let toOwner = ZERO;
  let fee = ZERO;
  let backToRenter = ZERO;
  for (const e of events) {
    const a = e.args;
    if (e.name === "Funded") paidIn += big(a.deposit) + big(a.firstRent);
    else if (e.name === "RentPaid") paidIn += big(a.amount);
    else if (e.name === "RentReleased") toOwner += big(a.toLandlord);
    else if (e.name === "ProtocolFeePaid") fee += big(a.amount);
    else if (e.name === "Settled") {
      toOwner += big(a.landlordClaim) + big(a.rentToLandlord) - big(a.fee);
      backToRenter += big(a.tenantRefund) + big(a.rentToTenant);
    }
  }
  return { paidIn, toOwner, fee, backToRenter };
}

export type MonthCell = { n: number; state: "out" | "in" | "due"; due: bigint };

/** One cell per month of the term (empty before the rental starts). */
export function monthCells(lease: LeaseData): MonthCell[] {
  if (lease.startTime === ZERO) return [];
  return Array.from({ length: lease.terms.termMonths }, (_, i) => ({
    n: i + 1,
    state: i < lease.monthsReleased ? "out" : i < lease.monthsFunded ? "in" : "due",
    due: lease.startTime + BigInt(i) * RENT_PERIOD,
  }));
}

export function banner(lease: LeaseData, viewer: Viewer, events: TimelineEvent[] | undefined, fmt: Fmt, c: RentalCopy): Banner {
  const b = c.banner;
  const t = lease.terms;
  const deposit = fmt(t.depositAmount);
  const idle = (label = b.nothing): BannerAction => ({ kind: "idle", label });
  const m = Math.max(1, Math.min(lease.monthsDue, t.termMonths));

  switch (lease.status) {
    case LeaseStatus.Created: {
      const total = fmt(t.depositAmount + t.rentAmount);
      if (viewer === "tenant") return { tone: "neutral", pill: c.pill.created, title: b.fundTitle(total), body: b.fundBody, action: { kind: "jump", to: "fund", label: b.fundAction(total), note: b.fundNote } };
      return { tone: "neutral", pill: c.pill.created, title: b.waitFundTitle, body: viewer === "landlord" ? b.waitFundOwner : b.waitFundOther, action: idle() };
    }
    case LeaseStatus.Active: {
      const pill = c.pill.month(m, t.termMonths);
      if (viewer === "tenant") {
        if (lease.checkOutHash !== zeroHash) return { tone: "ok", pill, title: b.returnedTitle, body: b.returnedBody(Math.round(t.responseWindow / 86400)), action: { kind: "jump", to: "return", label: b.proposeAction } };
        if (lease.monthsFunded < t.termMonths) {
          const next = lease.monthsFunded + 1;
          return {
            tone: "ok",
            pill,
            title: b.lockedTitle(deposit, true),
            body: b.payBody(lease.monthsFunded, next, lease.startTime + BigInt(lease.monthsFunded) * RENT_PERIOD),
            action: { kind: "jump", to: "rent", label: b.payAction(next, fmt(t.rentAmount)), note: b.payNote },
          };
        }
        return { tone: "ok", pill, title: b.lockedTitle(deposit, true), body: b.allPaidBody(t.termMonths), action: idle() };
      }
      if (viewer === "landlord") {
        const r = releasableMonths(lease, "landlord");
        const next = lease.startTime + BigInt(lease.monthsReleased) * RENT_PERIOD;
        if (r > 0) {
          const fee = lease.feeCharged ? ZERO : feeOf(lease);
          const amount = fmt(t.rentAmount * BigInt(r) - fee);
          return {
            tone: "ok",
            pill,
            title: b.collectTitle(amount),
            body: b.collectBody(fee > ZERO ? fmt(fee) : null),
            action: { kind: "tx", tx: "releaseRent", label: b.collectAction(lease.monthsReleased + 1, amount), note: b.oneConfirmation },
          };
        }
        const done = lease.monthsReleased >= t.termMonths;
        const net = moneyFlow(events).toOwner;
        return {
          tone: "ok",
          pill,
          title: lease.monthsReleased > 0 ? b.paidOwnerTitle(lease.monthsReleased, fmt(net)) : b.runningTitle,
          body: done ? b.allRentBody : b.nextDueBody(next),
          action: idle(done ? b.nothing : b.idleUntil(next)),
        };
      }
      if (viewer === "arbiter") return { tone: "ok", pill, title: b.noDisputeTitle, body: b.noDisputeBody, action: idle(b.nothingToRule) };
      return { tone: "ok", pill, title: b.lockedTitle(deposit, false), body: b.monthOf(m, t.termMonths), action: idle() };
    }
    case LeaseStatus.MoveOut: {
      const p = lease.proposal;
      const w = responseWindow({ ...lease, responseWindowSeconds: t.responseWindow });
      const days = Math.round(t.responseWindow / 86400);
      if (w.closed) {
        const pill = c.pill.closed(w.closesAt);
        if (viewer === "tenant") return { tone: "warn", pill, title: b.claimTitle(deposit), body: b.claimBody(days), action: { kind: "tx", tx: "claimTimeout", label: b.claimAction(deposit), note: b.oneConfirmation } };
        if (viewer === "landlord") return { tone: "warn", pill, title: b.closedOwnerTitle(w.closesAt), body: b.closedOwnerBody(days, deposit), action: idle(b.closedGone) };
        return { tone: "warn", pill, title: b.closedOtherTitle, body: b.closedOtherBody(deposit), action: idle(viewer === "arbiter" ? b.nothingToRule : b.nothing) };
      }
      const pill = c.pill.proposal;
      const by = viewerRole(lease, p.proposer);
      if ((viewer === "tenant" || viewer === "landlord") && viewer !== by)
        return {
          tone: "warn",
          pill,
          title: b.proposedTitle(roleName(by), fmt(p.tenantRefund), fmt(p.landlordClaim)),
          body: lease.timeoutAt > ZERO ? b.replyBy(lease.timeoutAt, viewer === "landlord") : b.replyAnytime,
          action: { kind: "jump", to: "return", label: b.replyAction },
        };
      if (viewer && viewer === by) return { tone: "neutral", pill, title: b.yourProposalTitle, body: lease.timeoutAt > ZERO ? b.theyHaveUntil(lease.timeoutAt) : b.theyDecide, action: idle() };
      return { tone: "neutral", pill, title: b.proposalWaitingTitle, body: b.proposedTitle(roleName(by), fmt(p.tenantRefund), fmt(p.landlordClaim)), action: idle(viewer === "arbiter" ? b.nothingToRule : b.nothing) };
    }
    case LeaseStatus.Disputed: {
      const pill = c.pill.disputed;
      if (lease.chainNow >= lease.arbiterDeadline)
        return {
          tone: "danger",
          pill,
          title: b.deskLateTitle,
          body: b.deskLateBody,
          action: viewer ? { kind: "tx", tx: "claimArbiterTimeout", label: b.deskLateAction(deposit), note: b.oneConfirmation } : idle(),
        };
      if (viewer === "arbiter") return { tone: "danger", pill, title: b.ruleTitle, body: b.ruleBody(lease.arbiterDeadline), action: { kind: "jump", to: "rule", label: b.ruleAction } };
      return { tone: "danger", pill, title: b.deskDecidingTitle, body: b.deskDecidingBody(lease.arbiterDeadline), action: idle() };
    }
    case LeaseStatus.Settled: {
      const f = events ? moneyFlow(events) : undefined;
      const title = f && viewer === "tenant" ? b.settledTenantTitle(fmt(f.backToRenter)) : f && viewer === "landlord" ? b.settledOwnerTitle(fmt(f.toOwner)) : b.settledTitle;
      return { tone: "neutral", pill: c.pill.settled, title, body: b.settledBody, action: idle(b.nothingLeft) };
    }
    case LeaseStatus.Cancelled:
      return { tone: "neutral", pill: c.pill.cancelled, title: b.cancelledTitle, body: b.cancelledBody, action: idle(b.nothingLeft) };
  }
}

export type ReturnStep = { title: string; sub: string; state: "todo" | "done" | "warn" | "skip" | "next"; when: string };

/** The five steps at return, with real dates where the chain already knows them. */
export function returnPlan(lease: LeaseData, events: TimelineEvent[] = [], c: RentalCopy): { sub: string; steps: ReturnStep[] } {
  const r = c.ret;
  const t = lease.terms;
  const at = (name: string, test: (e: TimelineEvent) => boolean = () => true) => events.findLast((e) => e.name === name && test(e))?.timestamp;
  const photosAt = at("EvidenceAdded", (e) => Number(e.args.kind) === 1);
  const proposedAt = at("SettlementProposed");
  const disputedAt = at("DisputeRaised");
  const settled = events.findLast((e) => e.name === "Settled");
  const basis = settled?.args.basis;
  const w = responseWindow({ ...lease, responseWindowSeconds: t.responseWindow });
  const deskLate = lease.status === LeaseStatus.Disputed && lease.chainNow >= lease.arbiterDeadline;
  const started = lease.startTime > ZERO;
  const planned = started ? returnAt(lease) : undefined;
  const replyDays = Math.round(t.responseWindow / 86400);
  const deskDays = Math.round(t.arbiterWindow / 86400);

  const step = (title: string, sub: string, state: ReturnStep["state"], when: string): ReturnStep => ({ title, sub, state, when });
  const photos = photosAt ? step(r.photos, r.photosSub, "done", r.on(photosAt)) : step(r.photos, r.photosSub, "todo", planned ? r.on(planned) : r.later);
  const split = proposedAt ? step(r.split, r.splitSub, "done", r.on(proposedAt)) : step(r.split, r.splitSub, "todo", r.later);

  let reply: ReturnStep;
  if (disputedAt) reply = step(r.reply(replyDays), r.replySub, "done", r.on(disputedAt));
  else if (w.closed || basis === LANDLORD_TIMEOUT_BASIS) reply = step(r.reply(replyDays), r.replySub, "warn", r.closed(w.closesAt || lease.timeoutAt || settled?.timestamp || ZERO));
  else if (settled && proposedAt) reply = step(r.reply(replyDays), r.replySub, "done", r.on(settled.timestamp));
  else if (lease.status === LeaseStatus.MoveOut && lease.timeoutAt > ZERO) reply = step(r.reply(replyDays), r.replySub, "next", r.by(lease.timeoutAt));
  else reply = step(r.reply(replyDays), r.replySub, "todo", r.later);

  let desk: ReturnStep;
  if (deskLate) desk = step(r.desk(deskDays), r.deskSub, "warn", r.closed(lease.arbiterDeadline));
  else if (lease.status === LeaseStatus.Disputed) desk = step(r.desk(deskDays), r.deskSub, "next", r.by(lease.arbiterDeadline));
  else if (disputedAt && settled) desk = step(r.desk(deskDays), r.deskSub, basis === ARBITER_TIMEOUT_BASIS ? "warn" : "done", r.on(settled.timestamp));
  else if (settled || w.closed) desk = step(r.desk(deskDays), r.deskSub, "skip", r.skipped);
  else desk = step(r.desk(deskDays), r.deskSub, "todo", r.ifDisputed);

  let back: ReturnStep;
  if (w.closed || deskLate) back = step(r.back, r.backSub, "next", r.now);
  else if (settled && (basis === LANDLORD_TIMEOUT_BASIS || basis === ARBITER_TIMEOUT_BASIS)) back = step(r.back, r.backSub, "done", r.on(settled.timestamp));
  else if (settled) back = step(r.back, r.backSub, "skip", r.skipped);
  else back = step(r.back, r.backSub, "todo", r.afterDeadline);

  return { sub: planned ? r.planned(planned) : c.notStarted, steps: [photos, split, reply, desk, back] };
}

/** The renter card's sentence and next action, from the chain-index summary (`you`: the viewer is this renter). */
export function renterLine(rental: RentalSummary, now: bigint, fmt: Fmt, c: RentalCopy, you: boolean): { sentence: string; action: string } {
  const s = c.renter.s;
  switch (rental.status) {
    case LeaseStatus.Created:
      return { sentence: s.created(you), action: c.renter.pay(fmt(rental.depositAmount + rental.rentAmount)) };
    case LeaseStatus.Active:
      if (rental.returnPhotos.length > 0) return { sentence: s.returned, action: c.renter.propose };
      return {
        sentence: s.active(fmt(rental.depositAmount), rental.monthsFunded, rental.termMonths, you),
        action: rental.monthsFunded < rental.termMonths ? c.renter.payMonth(rental.monthsFunded + 1) : c.renter.open,
      };
    case LeaseStatus.MoveOut: {
      const p = rental.proposal;
      const renterProposed = !!p && p.proposer.toLowerCase() === rental.tenant.toLowerCase();
      if (p && renterProposed && now >= p.proposedAt + BigInt(rental.responseWindow)) return { sentence: s.closed(you), action: c.renter.claim };
      return { sentence: s.proposal(fmt(p?.tenantRefund ?? ZERO)), action: c.renter.open };
    }
    case LeaseStatus.Disputed:
      return { sentence: s.disputed, action: c.renter.open };
    case LeaseStatus.Settled:
      return { sentence: s.settled(fmt(rental.totals.refunded), you), action: c.renter.seeWhat };
    case LeaseStatus.Cancelled:
      return { sentence: s.cancelled, action: c.renter.open };
  }
}

/** The rental the renter page shows as a live sample: the newest one that is running, else the newest. */
export function sampleRental(rentals: RentalSummary[]): RentalSummary | undefined {
  return rentals.find((r) => r.status === LeaseStatus.Active || r.status === LeaseStatus.MoveOut) ?? rentals[0];
}

export const isMe = (a: Address, me: string | undefined) => !!me && a.toLowerCase() === me.toLowerCase();
