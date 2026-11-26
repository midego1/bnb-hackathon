/**
 * Cards Ask AI shows. The SERVER builds every card from an action's own result (a lease snapshot read from the chain,
 * the prepared steps, the transaction receipts), never from the model's text, so a card cannot be talked into showing
 * something else. Counts and totals are computed here; the model is told to quote them.
 *
 * Client-safe types + pure builders (no server imports).
 */
import type { Explanation } from "../actions/explain";
import { formatUnits } from "viem";
import { formatToken, TOKEN, type StatusName } from "../actions/fields";
import type { LeaseSnapshot } from "../actions/lease";
import { explorerLink, explorerName } from "../chains";
import { formatFiat } from "../fiat";
import { periodCount, periodName } from "../rentals";
import { leasePath } from "./paths";

/** USDT -> fiat rates of the current price quote; `mock` = clearly marked demo rates. */
export type Rates = { THB: number; USD: number; mock: boolean };

/** An amount shown baht first, then dollars, then the token the contract stores. */
export type Money = { thb: string | null; usd: string | null; token: string; units: string };

export type CardLink = { label: string; href: string; external?: boolean };

export type LeaseCard = {
  kind: "lease";
  address: string;
  chainId: number;
  status: StatusName;
  statusLabel: string;
  headline: string;
  you: string | null;
  owner: string;
  renter: string;
  arbiter: string;
  rent: Money;
  deposit: Money;
  escrow: Money;
  /** Rent periods; `rentPeriod` in seconds (7, 14 or 30 days). */
  periods: { term: number; funded: number; released: number; rentPeriod: number };
  next: { who: string; what: string; deadline?: string } | null;
  links: CardLink[];
};

export type LeaseListRow = { address: string; role: string; status: StatusName; statusLabel: string; rent: Money; deposit: Money; href: string };

export type LeaseListCard = {
  kind: "lease_list";
  party: string;
  chainId: number;
  /** Counted by code over every row returned; the model quotes these. */
  totals: { all: number; byStatus: Partial<Record<StatusName, number>>; byRole: Record<string, number>; open: number; deposits: Money };
  rows: LeaseListRow[];
  truncated: boolean;
};

export type Change = { label: string; before?: string; after: string };

export type ApprovalCard = {
  kind: "approval";
  id: string;
  action: string;
  title: string;
  summary: string;
  signer: string;
  signerRole: string;
  chainId: number;
  lease?: string;
  changes: Change[];
  steps: { description: string; function: string; to: string }[];
  expiresAt: string;
  ratesMock: boolean;
};

export type DoneCard = {
  kind: "done";
  title: string;
  applied: number;
  chainId: number;
  txs: { hash: string; description: string; href?: string }[];
  lease?: { address: string; href: string };
};

export type Card = LeaseCard | LeaseListCard | ApprovalCard | DoneCard;

export const STATUS_LABEL: Record<StatusName, string> = {
  Created: "Awaiting funding",
  Active: "Active",
  MoveOut: "Return proposal",
  Disputed: "In dispute",
  Settled: "Settled",
  Cancelled: "Cancelled",
};

const OPEN: StatusName[] = ["Created", "Active", "MoveOut", "Disputed"];

export function money(units: bigint, rates: Rates | undefined): Money {
  const n = Number(formatUnits(units, TOKEN.decimals));
  return {
    thb: rates ? formatFiat(n * rates.THB, "THB") : null,
    usd: rates ? formatFiat(n * rates.USD, "USD") : null,
    token: formatToken(units),
    units: units.toString(),
  };
}

/** "฿3,400 · $103.03 · 103.03 mUSDT" (baht first). */
export function moneyText(m: Money): string {
  return [m.thb, m.usd, m.token].filter(Boolean).join(" · ");
}


const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function leaseCard(l: LeaseSnapshot, explanation: Explanation, rates: Rates | undefined): LeaseCard {
  const step = explanation.next.find((n) => n.deadline) ?? explanation.next[0];
  const who = { owner: "Owner", renter: "Renter", arbiter: "Dispute desk", anyone: "Anyone" } as const;
  const links: CardLink[] = [{ label: "Open rental", href: leasePath(l.address)! }];
  const ex = explorerLink(l.chainId, "address", l.address);
  if (ex) links.push({ label: explorerName(l.chainId)!, href: ex, external: true });
  return {
    kind: "lease",
    address: l.address,
    chainId: l.chainId,
    status: l.status,
    statusLabel: STATUS_LABEL[l.status],
    headline: explanation.headline,
    you: explanation.you === null ? null : explanation.you === "not a party" ? "not a party" : who[explanation.you],
    owner: l.terms.owner,
    renter: l.terms.renter,
    arbiter: l.terms.arbiter,
    rent: money(l.terms.rentAmount, rates),
    deposit: money(l.terms.depositAmount, rates),
    escrow: money(l.balance, rates),
    periods: { term: l.terms.termPeriods, funded: l.periodsFunded, released: l.periodsReleased, rentPeriod: l.terms.rentPeriod },
    next: step ? { who: who[step.who], what: step.what, ...(step.deadline ? { deadline: step.deadline } : {}) } : null,
    links,
  };
}

/** Rows as list_leases returns them (amounts in base units). */
export type ListedLease = { address: string; role: string; status: StatusName; rent: { units: string }; deposit: { units: string } };

export function leaseListCard(party: string, chainId: number, leases: ListedLease[], rates: Rates | undefined, truncated: boolean): LeaseListCard {
  const byStatus: Partial<Record<StatusName, number>> = {};
  const byRole: Record<string, number> = {};
  let open = 0;
  let held = BigInt(0);
  for (const l of leases) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    byRole[l.role] = (byRole[l.role] ?? 0) + 1;
    if (OPEN.includes(l.status)) open++;
    // Deposits still locked: funded and not yet paid out.
    if (l.status === "Active" || l.status === "MoveOut" || l.status === "Disputed") held += BigInt(l.deposit.units);
  }
  return {
    kind: "lease_list",
    party,
    chainId,
    totals: { all: leases.length, byStatus, byRole, open, deposits: money(held, rates) },
    rows: leases.map((l) => ({
      address: l.address,
      role: l.role,
      status: l.status,
      statusLabel: STATUS_LABEL[l.status],
      rent: money(BigInt(l.rent.units), rates),
      deposit: money(BigInt(l.deposit.units), rates),
      href: leasePath(l.address)!,
    })),
    truncated,
  };
}

/** One line per total, for the model: it must quote these instead of counting rows itself. */
export function listTotalsText(c: LeaseListCard): string {
  const status = Object.entries(c.totals.byStatus)
    .map(([s, n]) => `${n} ${STATUS_LABEL[s as StatusName].toLowerCase()}`)
    .join(", ");
  const roles = Object.entries(c.totals.byRole)
    .map(([r, n]) => `${n} as ${r}`)
    .join(", ");
  return (
    `TOTALS (exact, counted by KeyEscrow; quote these): ${c.totals.all} rental(s)${c.totals.all ? ` (${status}; ${roles})` : ""}, ` +
    `${c.totals.open} open, deposits locked in escrow: ${moneyText(c.totals.deposits)}.${c.truncated ? " Only the newest 50 per role are listed." : ""}`
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Approval: what signing the prepared steps will change, before -> after, from the lease as it is now.
// ---------------------------------------------------------------------------------------------------------------

export type ApprovalInput = {
  id: string;
  action: string;
  title: string;
  summary: string;
  signer: string;
  signerRole: string;
  chainId: number;
  steps: { description: string; function: string; to: string }[];
  expiresAt: number;
  /** The lease as read when the change was prepared (absent for create). */
  lease?: LeaseSnapshot;
  /** Parsed action input (bigints for token amounts). */
  input: Record<string, unknown>;
  /** Values the simulation returned (e.g. create's rent/deposit in base units). */
  expected?: Record<string, unknown>;
  rates?: Rates;
};

export function approvalCard(a: ApprovalInput): ApprovalCard {
  const r = a.rates;
  const m = (v: bigint) => moneyText(money(v, r));
  const l = a.lease;
  const changes: Change[] = [];
  const status = (after: StatusName) => changes.push({ label: "Status", before: l ? STATUS_LABEL[l.status] : undefined, after: STATUS_LABEL[after] });
  const escrow = (after: bigint) => l && changes.push({ label: "Held in escrow", before: m(l.balance), after: m(after) });

  switch (a.action) {
    case "prepare_create_lease": {
      const e = a.expected as { rent?: { units: string }; deposit?: { units: string } } | undefined;
      const period = Number(a.input.rentPeriodDays ?? 30) * 86_400;
      status("Created");
      changes.push({ label: "Renter", after: String(a.input.renter) });
      if (e?.rent) changes.push({ label: `Rent per ${periodName(period)}`, after: m(BigInt(e.rent.units)) });
      if (e?.deposit) changes.push({ label: "Deposit", after: m(BigInt(e.deposit.units)) });
      changes.push({ label: "Term", after: periodCount(Number(a.input.termPeriods), period) });
      break;
    }
    case "prepare_fund":
      if (l) {
        status("Active");
        const pay = l.terms.depositAmount + l.terms.rentAmount;
        escrow(l.balance + pay);
        changes.push({ label: "Renter pays", after: `${m(pay)} (deposit + the first ${periodName(l.terms.rentPeriod)})` });
      }
      break;
    case "prepare_release_rent":
      if (l) {
        const isRenter = l.terms.renter.toLowerCase() === a.signer.toLowerCase();
        const upTo = isRenter ? l.periodsFunded : Math.min(l.periodsDue, l.periodsFunded);
        const periods = Math.max(0, upTo - l.periodsReleased);
        const gross = BigInt(periods) * l.terms.rentAmount;
        changes.push({ label: "Rent paid out", before: periodCount(l.periodsReleased, l.terms.rentPeriod), after: periodCount(l.periodsReleased + periods, l.terms.rentPeriod) });
        escrow(l.balance - gross);
      }
      break;
    case "prepare_add_evidence":
      changes.push({ label: "Evidence", after: `+ ${({ check_in: "pickup photos", check_out: "return photos", other: "document" } as Record<string, string>)[String(a.input.kind)] ?? "file"} (hash only)` });
      break;
    case "prepare_propose_settlement":
      if (l) {
        const insp = a.input.inspection as { tenantRefund?: string } | undefined;
        const toRenter = insp?.tenantRefund !== undefined ? BigInt(insp.tenantRefund) : (a.input.toRenter as bigint);
        status("MoveOut");
        changes.push({ label: "Back to renter", before: l.proposal.nonce > 0 ? m(l.proposal.tenantRefund) : undefined, after: m(toRenter) });
        changes.push({ label: "Owner keeps", before: l.proposal.nonce > 0 ? m(l.proposal.landlordClaim) : undefined, after: m(l.terms.depositAmount - toRenter) });
      }
      break;
    case "prepare_accept":
      if (l) {
        status("Settled");
        escrow(BigInt(0));
        changes.push({ label: "Back to renter", after: m(l.proposal.tenantRefund) });
        changes.push({ label: "Owner keeps", after: m(l.proposal.landlordClaim) });
      }
      break;
    case "prepare_dispute":
      if (l) {
        status("Disputed");
        changes.push({ label: "Deposit", before: "can be settled by agreement", after: `frozen until the dispute desk rules (${Math.round(l.terms.arbiterWindow / 86400)} days)` });
      }
      break;
    case "prepare_resolve":
      if (l) {
        const toRenter = a.input.toRenter as bigint;
        status("Settled");
        escrow(BigInt(0));
        changes.push({ label: "Back to renter", after: m(toRenter) });
        changes.push({ label: "Owner keeps", after: m(l.terms.depositAmount - toRenter) });
      }
      break;
    case "prepare_claim_timeout":
      if (l) {
        status("Settled");
        escrow(BigInt(0));
        changes.push({ label: "Back to renter", after: `${m(l.terms.depositAmount)} (full deposit)` });
      }
      break;
    case "prepare_cancel":
      status("Cancelled");
      break;
  }

  return {
    kind: "approval",
    id: a.id,
    action: a.action,
    title: a.title,
    summary: a.summary,
    signer: a.signer,
    signerRole: a.signerRole,
    chainId: a.chainId,
    ...(l ? { lease: l.address } : {}),
    changes,
    steps: a.steps,
    expiresAt: new Date(a.expiresAt).toISOString(),
    ratesMock: r?.mock ?? true,
  };
}

export function doneCard(chainId: number, title: string, txs: { hash: string; description: string }[], lease?: string): DoneCard {
  const href = lease ? leasePath(lease) : null;
  return {
    kind: "done",
    title,
    applied: txs.length,
    chainId,
    txs: txs.map((t) => ({ ...t, ...(explorerLink(chainId, "tx", t.hash) ? { href: explorerLink(chainId, "tx", t.hash) } : {}) })),
    ...(lease && href ? { lease: { address: lease, href } } : {}),
  };
}

export { short as shortAddress };
