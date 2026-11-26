import type { ReactNode } from "react";
import { LeaseStatus } from "@/lib/contracts";
import type { T } from "@/lib/i18n/t";
import { nthIn, perIn, type RentalSummary } from "@/lib/rentals";

/**
 * The renter page's words and its card sentence, from the dictionary (lib/i18n/dictionaries/en/roles.ts). Kept apart
 * from the rental page's copy so /tenant does not ship that page's code. The card sentences are headlines (bilingual
 * in EN+中文), so they are ReactNodes.
 */
export function renterCopyFor(t: T) {
  return {
    fallbackTitle: t("renter.fallbackTitle"),
    pay: (total: string) => t("renter.pay", { total }),
    payPeriod: (n: number, rentPeriod: number) => t("renter.payPeriod", { nth: nthIn(t, n, rentPeriod) }),
    per: (rentPeriod: number) => t("renter.perPeriod", { per: perIn(t, rentPeriod) }),
    open: t("renter.open"),
    propose: t("renter.propose"),
    claim: t("renter.claim"),
    seeWhat: t("renter.seeWhat"),
    s: {
      created: (you: boolean) => t.h(you ? "renter.s.createdYou" : "renter.s.createdOther"),
      active: (deposit: string, paid: number, term: number, you: boolean) => t.h(you ? "renter.s.activeYou" : "renter.s.activeOther", { deposit, paid, term }),
      returned: t.h("renter.s.returned"),
      proposal: (back: string) => t.h("renter.s.proposal", { back }),
      closed: (you: boolean) => t.h(you ? "renter.s.closedYou" : "renter.s.closedOther"),
      disputed: t.h("renter.s.disputed"),
      settled: (back: string, you: boolean) => t.h(you ? "renter.s.settledYou" : "renter.s.settledOther", { back }),
      cancelled: t.h("renter.s.cancelled"),
    },
  };
}

export type RenterCopy = ReturnType<typeof renterCopyFor>;

const ZERO = BigInt(0);

/** The renter card's sentence and next action, from the chain-index summary (`you`: the viewer is this renter). */
export function renterLine(rental: RentalSummary, now: bigint, fmt: (v: bigint) => string, c: RenterCopy, you: boolean): { sentence: ReactNode; action: string } {
  const s = c.s;
  switch (rental.status) {
    case LeaseStatus.Created:
      return { sentence: s.created(you), action: c.pay(fmt(rental.depositAmount + rental.rentAmount)) };
    case LeaseStatus.Active:
      if (rental.returnPhotos.length > 0) return { sentence: s.returned, action: c.propose };
      return {
        sentence: s.active(fmt(rental.depositAmount), rental.periodsFunded, rental.termPeriods, you),
        action: rental.periodsFunded < rental.termPeriods ? c.payPeriod(rental.periodsFunded + 1, rental.rentPeriod) : c.open,
      };
    case LeaseStatus.MoveOut: {
      const p = rental.proposal;
      const renterProposed = !!p && p.proposer.toLowerCase() === rental.tenant.toLowerCase();
      if (p && renterProposed && now >= p.proposedAt + BigInt(rental.responseWindow)) return { sentence: s.closed(you), action: c.claim };
      return { sentence: s.proposal(fmt(p?.tenantRefund ?? ZERO)), action: c.open };
    }
    case LeaseStatus.Disputed:
      return { sentence: s.disputed, action: c.open };
    case LeaseStatus.Settled:
      return { sentence: s.settled(fmt(rental.totals.refunded), you), action: c.seeWhat };
    case LeaseStatus.Cancelled:
      return { sentence: s.cancelled, action: c.open };
  }
}

/** The rental the renter page shows as a live sample: the newest one that is running, else the newest. */
export function sampleRental(rentals: RentalSummary[]): RentalSummary | undefined {
  return rentals.find((r) => r.status === LeaseStatus.Active || r.status === LeaseStatus.MoveOut) ?? rentals[0];
}
