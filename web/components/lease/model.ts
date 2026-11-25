import type { Address } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import { formatDate } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";

export type Viewer = "landlord" | "tenant" | "arbiter" | null;

export function viewerRole(lease: LeaseData, who: Address | undefined): Viewer {
  if (!who) return null;
  const w = who.toLowerCase();
  if (lease.terms.landlord.toLowerCase() === w) return "landlord";
  if (lease.terms.tenant.toLowerCase() === w) return "tenant";
  if (lease.terms.arbiter.toLowerCase() === w) return "arbiter";
  return null;
}

/** How a role is named in the UI: the arbiter is "the dispute desk" everywhere. */
export function roleName(v: Viewer): string {
  return v === "arbiter" ? "dispute desk" : (v ?? "someone");
}

export function roleOfAddress(lease: LeaseData, a: unknown): string {
  return roleName(viewerRole(lease, a as Address));
}

export const RENT_PERIOD = BigInt(30 * 24 * 3600);

/** Month index the next release would cover, and when it is due. */
export function nextDue(lease: LeaseData): bigint | undefined {
  if (lease.startTime === BigInt(0) || lease.monthsReleased >= lease.terms.termMonths) return undefined;
  return lease.startTime + BigInt(lease.monthsReleased) * RENT_PERIOD;
}

/** How many funded months `viewer` can release right now (tenant may release early). */
export function releasableMonths(lease: LeaseData, viewer: Viewer): number {
  const live = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;
  if (!live) return 0;
  const upTo = viewer === "tenant" ? lease.monthsFunded : Math.min(lease.monthsDue, lease.monthsFunded);
  return Math.max(0, upTo - lease.monthsReleased);
}

/** One-line "what happens next" for the person looking at the lease. */
export function nextStep(lease: LeaseData, viewer: Viewer): string {
  const p = lease.proposal;
  switch (lease.status) {
    case LeaseStatus.Created:
      return viewer === "tenant" ? "Your move: fund the deposit and first month's rent." : "Waiting for the tenant to fund the deposit and first month's rent.";
    case LeaseStatus.Active: {
      const r = releasableMonths(lease, viewer);
      if (r > 0) return `${r} month${r > 1 ? "s" : ""} of rent ready to pay out to the landlord.`;
      const due = nextDue(lease);
      return `Month ${Math.min(lease.monthsDue, lease.terms.termMonths)} of ${lease.terms.termMonths}. ${
        due ? `Next rent due ${formatDate(due)}.` : "All rent paid out."
      }`;
    }
    case LeaseStatus.MoveOut: {
      const mine = viewer && p.proposer.toLowerCase() === (viewer === "landlord" ? lease.terms.landlord : lease.terms.tenant).toLowerCase();
      if (viewer === "landlord" || viewer === "tenant")
        return mine ? "Waiting for the other side to accept your deposit proposal." : "Your move: accept the deposit proposal, counter it or open a dispute.";
      return "A deposit proposal is waiting for an answer.";
    }
    case LeaseStatus.Disputed:
      return viewer === "arbiter" ? "Your move: rule on the deposit split." : "In dispute: waiting for the dispute desk to rule.";
    case LeaseStatus.Settled:
      return "Closed. Deposit and rent fully paid out.";
    case LeaseStatus.Cancelled:
      return "Offer withdrawn before funding.";
  }
}
