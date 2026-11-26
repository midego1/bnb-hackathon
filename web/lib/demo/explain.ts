import { localized, type Lang } from "../i18n/locales";
import { zhExplain } from "./explain.zh";
import type { DemoCtx } from "./script";

/**
 * Guided narration for /demo, as data: for every step of every story, "What happens now" (who acts and what they
 * do) and "What just changed" (why it matters, what the contract guarantees), plus the cards that receive
 * something in that step. Plain English, short sentences; the first use of a term carries a 3-word gloss.
 *
 * The words work for any rental: the asset is `ctx.property.name`, and the two sides are named through `Cast`
 * (the actor-card names from components/demo/copy.ts), never "apartment", "landlord" or "scooter" by hand.
 */

/** Lower-case nouns for the two sides, e.g. { landlord: "landlord", tenant: "tenant" } or "owner" / "renter". */
export type Cast = { landlord: string; tenant: string };
type Money = (v: bigint) => string;
type Text = (c: DemoCtx, m: Money, who: Cast) => string;

/** A card on the stage that gets something in this step: money, a record or a proposal. */
export type Receiver = "landlord" | "tenant" | "escrow" | "treasury" | "arbiter" | "inspector";
export type Explain = { now: Text; changed: Text; to: Receiver[] };

const need = (c: DemoCtx) => c.deposit + c.rent;
const days = (seconds: number) => Math.round(seconds / 86_400);
const REPLY_DAYS = 7;
const DESK_DAYS = 14;

/** Who gets the owner's payouts: the owner, or in the Fleet Vault story the vault the scooter belongs to. */
const payee = (c: DemoCtx, w: Cast) => (c.path === "fleet" ? "the Fleet Vault" : `the ${w.landlord}`);
const feeOf = (c: DemoCtx) => c.fee ?? (c.rent * BigInt(c.feeBps ?? 1000)) / BigInt(10_000);
const split = (c: DemoCtx) => ({
  back: c.settled?.tenantRefund ?? (c.inspection ? BigInt(c.inspection.tenantRefund) : undefined),
  keep: c.settled?.landlordClaim ?? (c.inspection ? BigInt(c.inspection.landlordClaim) : undefined),
});

export const EXPLAIN: Record<string, Explain> = {
  create: {
    now: (c, m, w) =>
      `The ${w.landlord} offers the rental: ${c.property.name}, ${m(c.rent)} a month, ${m(c.deposit)} deposit. ` +
      `KeyScrow creates an escrow contract for this rental only, on-chain (on the public blockchain).`,
    changed: () =>
      `The rental now has its own contract with the agreed terms. The signed agreement stays off-chain; ` +
      `only its fingerprint (a unique file code) goes on-chain, so nobody can swap it.`,
    to: ["escrow"],
  },
  checkin: {
    now: (_c, _m, w) =>
      `The ${w.landlord} records the photos taken at the start of the rental. ` +
      `Each photo's fingerprint is written to the escrow contract, one transaction per photo.`,
    changed: () =>
      "The starting condition is on record for good. At the end, the AI compares against exactly these photos.",
    to: ["escrow"],
  },
  faucet: {
    now: (c, m, w) =>
      `The ${w.tenant} pays in USDT, a stablecoin (a digital dollar). ` +
      `On this demo chain, a free test tap gives the ${w.tenant} the ${m(need(c))} needed.`,
    changed: (c, m, w) =>
      c.faucet === BigInt(0)
        ? `The ${w.tenant} already had enough test USDT, so nothing was added. Nothing is locked yet: the money is still in the ${w.tenant}'s own wallet.`
        : `The ${w.tenant}'s wallet now holds ${m(need(c))} of test USDT. Nothing is locked yet: the money is still the ${w.tenant}'s own.`,
    to: ["tenant"],
  },
  fund: {
    now: (c, m, w) =>
      `The ${w.tenant} pays the deposit plus month 1: ${m(need(c))}. ` +
      `Two signatures: "approve" lets the escrow take the money, then "fund" moves it in.`,
    changed: (_c, _m, w) =>
      `The deposit is now locked in this rental's own escrow contract. It did not go to the ${w.landlord}. ` +
      `Neither ${w.landlord} nor ${w.tenant} can take it out alone.`,
    to: ["escrow"],
  },
  rent: {
    now: (c, _m, w) =>
      `Month 1 rent is due. The ${w.tenant} releases it to ${payee(c, w)}. ` +
      `KeyScrow's only fee comes out of this first month: ${((c.feeBps ?? 1000) / 100).toFixed(0)}% of one month's rent.`,
    changed: (c, m, w) =>
      `${payee(c, w).replace(/^t/, "T")} got ${m(c.rentToLandlord ?? c.rent - feeOf(c))} and the KeyScrow treasury ${m(feeOf(c))}. ` +
      `The deposit stays locked in escrow.`,
    to: ["landlord", "treasury"],
  },
  checkout: {
    now: (_c, _m, w) =>
      `The rental is over; the demo skips the months in between. ` +
      `The ${w.tenant} takes end photos from the same angles. Two show new damage.`,
    changed: () =>
      "Start and end photos are now both on record, side by side. Still no deposit money has moved.",
    to: ["escrow"],
  },
  inspect: {
    now: () =>
      `The AI Inspector compares the start and end photos. ` +
      `It lists new damage, estimates the repair cost, and drafts a split of the deposit.`,
    changed: (c, m, w) => {
      const s = split(c);
      const draft = s.back !== undefined && s.keep !== undefined ? `The AI drafted ${m(s.back)} back to the ${w.tenant} and ${m(s.keep)} to the ${w.landlord} for repairs. ` : "";
      return `${draft}The AI only proposes. People decide: they can accept it, change it, or dispute it.`;
    },
    to: ["inspector"],
  },
  propose: {
    now: (_c, _m, w) =>
      `The ${w.tenant} agrees and proposes the AI split on-chain, ` +
      `with the AI report's fingerprint, so anyone can check what it was based on.`,
    changed: (_c, _m, w) =>
      `The ${w.landlord} now has ${REPLY_DAYS} days to accept, counter or dispute. ` +
      `If the ${w.landlord} does nothing, the full deposit goes back to the ${w.tenant}.`,
    to: ["landlord"],
  },
  accept: {
    now: (_c, _m, w) =>
      `The ${w.landlord} checks the photos and the AI's reasons, and accepts. One signature settles it: the contract pays both sides at once.`,
    changed: (c, m, w) => {
      const s = split(c);
      const paid = s.back !== undefined && s.keep !== undefined ? `${m(s.back)} went back to the ${w.tenant} and ${m(s.keep)} to ${payee(c, w)}. ` : "";
      return `${paid}No agent, no court, no weeks of waiting. The escrow is now empty.`;
    },
    to: ["tenant", "landlord"],
  },
  dispute: {
    now: (_c, _m, w) =>
      `The ${w.landlord} thinks the repairs cost more than the AI says, and opens a dispute. ` +
      `That is the ${w.landlord}'s right: the AI only proposes.`,
    changed: (_c, _m, w) =>
      `The deposit is frozen. Now only the dispute desk can split it, within ${DESK_DAYS} days. ` +
      `If the desk misses that deadline, the full deposit goes back to the ${w.tenant}.`,
    to: ["arbiter"],
  },
  resolve: {
    now: () =>
      "The dispute desk, a neutral referee, reviews the same photos and the AI report, then rules on a split. " +
      "It can never keep any of the deposit.",
    changed: (c, m, w) => {
      const back = c.settled?.tenantRefund ?? c.ruling?.tenantRefund;
      const keep = c.settled?.landlordClaim ?? c.ruling?.landlordClaim;
      const paid = back !== undefined && keep !== undefined ? `The ruling paid out: ${m(back)} to the ${w.tenant}, ${m(keep)} to the ${w.landlord}. ` : "";
      return `${paid}The ruling's fingerprint is stored on-chain with the payout, for anyone to check.`;
    },
    to: ["tenant", "landlord"],
  },
  wait: {
    now: (_c, _m, w) =>
      `The ${w.landlord} does not answer. On a real network we would wait ${REPLY_DAYS} days. ` +
      "This local demo chain can jump its clock forward; a real one cannot.",
    changed: (c, _m, w) =>
      `${c.fastForwarded ? days(c.fastForwarded) : REPLY_DAYS} days have passed on the chain's clock. The ${w.landlord}'s time to answer is over. No money has moved yet.`,
    to: [],
  },
  timeout: {
    now: (_c, _m, w) => `The ${w.landlord}'s reply window has closed, so anyone may now close the rental. The ${w.tenant} does it with one transaction.`,
    changed: (c, m, w) =>
      `The full ${m(c.deposit)} deposit went back to the ${w.tenant}, not just the AI split. ` +
      `Silence can never cost the ${w.tenant} money.`,
    to: ["tenant"],
  },
  vault: {
    now: () =>
      "This rental belongs to the Fleet Vault, a shared pot owned by its shareholders. " +
      "We read how much new income the vault got from this rental, and what one demo shareholder can now claim.",
    changed: (c, m) => {
      const v = c.vaultIncome;
      const got = v ? `The vault's new income went from ${m(v.before)} to ${m(v.after)}; the demo shareholder can claim ${m(v.claimable)}. ` : "";
      return `${got}The rent and the repair money went straight to the vault, not to one person. The shareholders split it.`;
    },
    to: [],
  },
  final: {
    now: (_c, _m, w) => `Last step: we read every balance and check the books. All the ${w.tenant} paid in must be accounted for.`,
    changed: (_c, _m, w) =>
      `The escrow is empty. Every baht went to the ${w.landlord}, the KeyScrow treasury, or back to the ${w.tenant}.`,
    to: [],
  },
};

/** The narration in a language (Chinese in explain.zh.ts). */
export const explain = localized(EXPLAIN, zhExplain);

/** The explanation for a step; a step without one (should not happen) falls back to its title. */
export function explainFor(id: string, lang: Lang = "en"): Explain {
  return explain(lang)[id] ?? { now: () => "", changed: () => "", to: [] };
}
