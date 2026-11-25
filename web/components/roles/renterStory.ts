import { LeaseStatus } from "@/lib/contracts";
import type { RentalSummary } from "@/lib/rentals";

/**
 * The renter page's words and its card sentence (English; a translation replaces `renterCopy` whole). Kept apart from
 * the rental page's copy so /tenant does not ship that page's code.
 */
export const renterCopy = {
  fallbackTitle: "Scooter rental",
  heroTitle: "Rent a scooter without leaving your passport.",
  heroBody:
    "Your deposit and rent go into a small smart contract made for your rental, not to the shop. The deposit comes back when you return the scooter: only you and the shop together, or a neutral dispute desk, can move it.",
  connect: "Connect your wallet",
  demo: "Open the live demo",
  howItWorks: "How it works, explained simply",
  devHint: "Local demo: pick Renter in the yellow “Demo accounts” bar to see a renter's rentals.",
  sampleTitle: "A real rental, live on the chain",
  sampleNone: "No rentals on this network yet.",
  yours: "Your rentals",
  noneYet: "No rentals for this wallet yet. Book a scooter below, or send the shop your wallet address.",
  perMonth: "per month",
  depositLabel: "deposit",
  open: "Open rental",
  pay: (total: string) => `Pay ${total} to start`,
  payMonth: (n: number) => `Pay month ${n}`,
  propose: "Propose the split",
  claim: "Claim deposit",
  seeWhat: "See what happened",
  s: {
    created: (you: boolean) => (you ? "Waiting for you to pay in the deposit and month 1." : "Waiting for the renter to pay in."),
    active: (deposit: string, paid: number, term: number, you: boolean) =>
      `${you ? "Your" : "The"} ${deposit} deposit is locked. Rent is paid through month ${paid} of ${term}.`,
    returned: "Scooter returned. Next: propose how to split the deposit.",
    proposal: (back: string) => `Return proposal open: ${back} back to the renter.`,
    closed: (you: boolean) => (you ? "The owner did not reply in time. Claim your full deposit." : "The owner did not reply in time: the deposit goes back."),
    disputed: "The dispute desk is deciding how to split the deposit.",
    settled: (back: string, you: boolean) => `Closed. ${you ? "You" : "The renter"} got ${back} back.`,
    cancelled: "The owner withdrew the offer.",
  },
};

export type RenterCopy = typeof renterCopy;

const ZERO = BigInt(0);

/** The renter card's sentence and next action, from the chain-index summary (`you`: the viewer is this renter). */
export function renterLine(rental: RentalSummary, now: bigint, fmt: (v: bigint) => string, c: RenterCopy, you: boolean): { sentence: string; action: string } {
  const s = c.s;
  switch (rental.status) {
    case LeaseStatus.Created:
      return { sentence: s.created(you), action: c.pay(fmt(rental.depositAmount + rental.rentAmount)) };
    case LeaseStatus.Active:
      if (rental.returnPhotos.length > 0) return { sentence: s.returned, action: c.propose };
      return {
        sentence: s.active(fmt(rental.depositAmount), rental.monthsFunded, rental.termMonths, you),
        action: rental.monthsFunded < rental.termMonths ? c.payMonth(rental.monthsFunded + 1) : c.open,
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
