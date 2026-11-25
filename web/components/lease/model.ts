import type { Address } from "viem";
import { LeaseStatus } from "@/lib/contracts";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { T } from "@/lib/i18n/t";
import { dateTimeIn } from "./copy";

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
export function roleName(v: Viewer, t: T): string {
  return t(`rental.role.${v ?? "none"}`);
}

export function roleOfAddress(lease: LeaseData, a: unknown, t: T): string {
  return roleName(viewerRole(lease, a as Address), t);
}

export const RENT_PERIOD = BigInt(30 * 24 * 3600);

/** Month index the next release would cover, and when it is due. */
export function nextDue(lease: LeaseData): bigint | undefined {
  if (lease.startTime === BigInt(0) || lease.monthsReleased >= lease.terms.termMonths) return undefined;
  return lease.startTime + BigInt(lease.monthsReleased) * RENT_PERIOD;
}

/** How many funded months `viewer` can release right now (renter may release early). */
export function releasableMonths(lease: LeaseData, viewer: Viewer): number {
  const live = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;
  if (!live) return 0;
  const upTo = viewer === "tenant" ? lease.monthsFunded : Math.min(lease.monthsDue, lease.monthsFunded);
  return Math.max(0, upTo - lease.monthsReleased);
}

/** One-line "what happens next" for the person looking at the rental. */
export function nextStep(lease: LeaseData, viewer: Viewer, t: T): string {
  const p = lease.proposal;
  switch (lease.status) {
    case LeaseStatus.Created:
      return t(viewer === "tenant" ? "rental.next.fundTenant" : "rental.next.fundOther");
    case LeaseStatus.Active: {
      const r = releasableMonths(lease, viewer);
      if (r > 0) return t(r > 1 ? "rental.next.ready.other" : "rental.next.ready.one", { n: r });
      const due = nextDue(lease);
      return (
        t("rental.next.month", { m: Math.min(lease.monthsDue, lease.terms.termMonths), term: lease.terms.termMonths }) +
        (due ? t("rental.next.nextDue", { date: dateTimeIn(t)(due) }) : t("rental.next.allOut"))
      );
    }
    case LeaseStatus.MoveOut: {
      const mine = viewer && p.proposer.toLowerCase() === (viewer === "landlord" ? lease.terms.landlord : lease.terms.tenant).toLowerCase();
      if (viewer === "landlord" || viewer === "tenant") return t(mine ? "rental.next.waitOther" : "rental.next.yourMove");
      return t("rental.next.waiting");
    }
    case LeaseStatus.Disputed:
      return t(viewer === "arbiter" ? "rental.next.rule" : "rental.next.disputed");
    case LeaseStatus.Settled:
      return t("rental.next.settled");
    case LeaseStatus.Cancelled:
      return t("rental.next.cancelled");
  }
}
