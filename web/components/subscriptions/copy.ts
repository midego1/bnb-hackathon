import { useMemo } from "react";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/t";
import type { Rhythm } from "@/lib/fleet";
import { countIn, nthIn, perIn } from "@/lib/rentals";
import type { SubState } from "@/lib/subscriptions";
import { TOKEN } from "@/lib/contracts";

/**
 * Every user-facing string of the subscription views, in the visitor's language (dictionaries/{en,zh}/subs.ts).
 * Titles and the status sentences are headlines (t.h): EN+中文 adds the Chinese line under them.
 */
export function subsCopyFor(t: T) {
  const byRhythm = (k: "rhythm" | "per") => ({ 7: t(`subs.${k}.d7`), 14: t(`subs.${k}.d14`), 30: t(`subs.${k}.d30`) }) satisfies Record<Rhythm, string>;
  const plural = (n: number) => (n === 1 ? "one" : "other");
  const secs = (r: Rhythm) => r * 86_400;
  return {
    pageTitle: t("subs.pageTitle"),
    pageIntro: t("subs.pageIntro"),
    gate: t("subs.gate"),
    what: t("subs.what"),
    rhythm: byRhythm("rhythm"),
    per: byRhythm("per"),
    rhythmLabel: t("subs.rhythmLabel"),
    rhythmHint: t("subs.rhythmHint"),
    perPeriod: (amount: string, r: Rhythm) => t("subs.perPeriod", { amount, per: perIn(t, secs(r)) }),

    plans: {
      title: t.h("subs.plans"),
      empty: t("subs.plans.empty"),
      deposit: (thb: string) => t("subs.plans.deposit", { thb }),
      term: (n: number, r: Rhythm) => t("subs.plans.term", { count: countIn(t, n, secs(r)) }),
      upfront: (r: Rhythm) => t("subs.plans.upfront", { first: nthIn(t, 1, secs(r)) }),
      subscribe: t("subs.plans.subscribe"),
      requested: t("subs.plans.requested"),
      notAvailable: t("subs.plans.notAvailable"),
      connect: t("subs.plans.connect"),
    },

    mine: {
      title: t.h("subs.mine"),
      empty: t("subs.mine.empty"),
      nextPayment: t("subs.mine.nextPayment"),
      paidThrough: (n: number, of: number, r: Rhythm) => t("subs.mine.paidThrough", { n, count: countIn(t, of, secs(r)) }),
      deposit: t("subs.mine.deposit"),
      open: t("subs.mine.open"),
      loading: t("subs.mine.loading"),
      getUsdt: t("subs.mine.getUsdt"),
      approve: t("subs.mine.approve"),
      start: (r: Rhythm) => t("subs.mine.start", { first: nthIn(t, 1, secs(r)) }),
      pay: (n: number, r: Rhythm) => t("subs.mine.pay", { nth: nthIn(t, n, secs(r)) }),
      payHint: t("subs.mine.payHint"),
      notEnough: t("subs.mine.notEnough"),
      allPaid: t("subs.mine.allPaid"),
      cancel: t("subs.mine.cancel"),
      cancelTitle: t("subs.mine.cancelTitle"),
      cancelBody: t("subs.mine.cancelBody"),
      cancelConfirm: t("subs.mine.cancelConfirm"),
    },

    /** The big status sentence on each subscription card. */
    state: {
      requested: () => t.h("subs.state.requested"),
      issued: () => t.h("subs.state.issued"),
      active: (due: string, amount: string) => t.h("subs.state.active", { due, amount }),
      activePaid: () => t.h("subs.state.activePaid"),
      overdue: (due: string, amount: string) => t.h("subs.state.overdue", { due, amount }),
      cancelling: () => t.h("subs.state.cancelling"),
      disputed: () => t.h("subs.state.disputed"),
      ended: () => t.h("subs.state.ended"),
    } satisfies Record<SubState | "activePaid" | "overdue", (...a: string[]) => unknown>,

    owner: {
      title: t.h("subs.title"),
      mrr: t("subs.owner.mrr"),
      mrrHint: (usdt: string) => t("subs.owner.mrrHint", { usdt, symbol: TOKEN.symbol }),
      subscribers: t("subs.owner.subscribers"),
      offerTitle: t.h("subs.offerTitle"),
      scooter: t("subs.owner.scooter"),
      price: t("subs.owner.price"),
      deposit: t("subs.owner.deposit"),
      depositShort: (thb: string) => t("subs.owner.depositShort", { thb }),
      maxMonths: t("subs.owner.maxMonths"),
      maxMonthsHint: t("subs.owner.maxMonthsHint"),
      save: t("subs.owner.save"),
      saved: (name: string) => t("subs.owner.saved", { name }),
      noScooters: t("subs.owner.noScooters"),
      plansEmpty: t("subs.owner.plansEmpty"),
      planCard: (n: number, r: Rhythm) => t("subs.owner.planCard", { count: countIn(t, n, secs(r)) }),
      subscriberOf: (n: number) => t(`subs.owner.subscriberOf.${n ? plural(n) : "none"}`, { n }),
    },

    shareholders: {
      mrr: t("subs.shareholders.mrr"),
      hint: (n: number) => t(`subs.shareholders.hint.${plural(n)}`, { n }),
    },
  };
}

export type SubsCopy = ReturnType<typeof subsCopyFor>;

/** The subscription views' copy in the visitor's language. */
export function useSubsCopy() {
  const t = useT();
  return useMemo(() => subsCopyFor(t), [t]);
}
