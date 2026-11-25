import type { Address } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import { formatDate } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { periodCount, periodName } from "@/lib/rentals";

export type Viewer = "landlord" | "tenant" | "arbiter" | null;

export function viewerRole(lease: LeaseData, who: Address | undefined): Viewer {
  if (!who) return null;
  const w = who.toLowerCase();
  if (lease.terms.landlord.toLowerCase() === w) return "landlord";
  if (lease.terms.tenant.toLowerCase() === w) return "tenant";
  if (lease.terms.arbiter.toLowerCase() === w) return "arbiter";
  return null;
}

/** How a role is named in the UI: landlord = "owner" (the rental shop), tenant = "renter", arbiter = "dispute desk". */
export function roleName(v: Viewer): string {
  return v === "arbiter" ? "dispute desk" : v === "landlord" ? "owner" : v === "tenant" ? "renter" : "someone";
}

export function roleOfAddress(lease: LeaseData, a: unknown): string {
  return roleName(viewerRole(lease, a as Address));
}

/** When the rent period the next release would cover is due. */
export function nextDue(lease: LeaseData): bigint | undefined {
  if (lease.startTime === BigInt(0) || lease.periodsReleased >= lease.terms.termPeriods) return undefined;
  return lease.startTime + BigInt(lease.periodsReleased) * BigInt(lease.terms.rentPeriod);
}

/** How many funded rent periods `viewer` can release right now (renter may release early). */
export function releasablePeriods(lease: LeaseData, viewer: Viewer): number {
  const live = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;
  if (!live) return 0;
  const upTo = viewer === "tenant" ? lease.periodsFunded : Math.min(lease.periodsDue, lease.periodsFunded);
  return Math.max(0, upTo - lease.periodsReleased);
}

/** One-line "what happens next" for the person looking at the rental. */
export function nextStep(lease: LeaseData, viewer: Viewer): string {
  const p = lease.proposal;
  switch (lease.status) {
    case LeaseStatus.Created:
      return viewer === "tenant" ? `Your move: fund the deposit and the first ${periodName(lease.terms.rentPeriod)}'s rent.` : `Waiting for the renter to fund the deposit and the first ${periodName(lease.terms.rentPeriod)}'s rent.`;
    case LeaseStatus.Active: {
      const r = releasablePeriods(lease, viewer);
      if (r > 0) return `${periodCount(r, lease.terms.rentPeriod)} of rent ready to pay out to the owner.`;
      const due = nextDue(lease);
      return `Rent period ${Math.min(lease.periodsDue, lease.terms.termPeriods)} of ${lease.terms.termPeriods} (per ${periodName(lease.terms.rentPeriod)}). ${
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
