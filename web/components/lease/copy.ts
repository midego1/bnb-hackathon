import { useMemo, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/t";

/**
 * Every sentence of the rental page, built from the dictionary (lib/i18n/dictionaries/en/rental.ts and zh/rental.ts)
 * for the active language. Amounts arrive already formatted (baht first) and dates as unix seconds. The banner titles
 * are headlines (t.h): English with the Chinese line under it in EN+中文.
 */

const locale = (t: T) => (t.lang === "zh" ? "zh-CN" : "en-GB");

/** "12 Jan" (UTC). */
export const dayIn = (t: T) => (ts: bigint) => new Date(Number(ts) * 1000).toLocaleDateString(locale(t), { day: "numeric", month: "short", timeZone: "UTC" });

/** "12 Jan 2027, 08:00" in the browser's time zone (lib/format formatDate, in the active language). */
export const dateTimeIn = (t: T) => (ts: bigint | number) =>
  new Date(Number(ts) * 1000).toLocaleString(locale(t), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "15 Jan 2027, 08:00 UTC" (lib/windows.ts UTC_DATE, in the active language). */
export const utcDateTimeIn = (t: T) => (ts: bigint | number) =>
  new Date(Number(ts) * 1000).toLocaleString(locale(t), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

export const monthsIn = (t: T) => (n: number) => t(n === 1 ? "rental.months.one" : "rental.months.other", { n });

type Role = "arbiter" | "landlord" | "tenant" | "none";
const roleKey = (by: string | null): Role => (by === "arbiter" || by === "landlord" || by === "tenant" ? by : "none");

export function rentalCopyFor(t: T) {
  const day = dayIn(t);
  const months = monthsIn(t);
  const h = (key: Parameters<T["h"]>[0], vars?: Record<string, string | number>): ReactNode => t.h(key, vars);
  return {
    day,
    fallbackTitle: h("rental.fallbackTitle"),
    ownerShort: (a: string) => t("rental.ownerShort", { address: a }),
    period: (from: bigint, to: bigint) => t("rental.period", { from: day(from), to: day(to) }),
    notStarted: t("rental.notStarted"),
    escrowLink: (short: string, explorer: boolean) => t(explorer ? "rental.escrowLink" : "rental.escrowLinkLocal", { short }),
    youAre: { landlord: t("rental.youAre.landlord"), tenant: t("rental.youAre.tenant"), arbiter: t("rental.youAre.arbiter") },
    readOnly: (wallet: boolean) => t(wallet ? "rental.readOnlyWallet" : "rental.readOnlyConnect"),
    back: { arbiter: t("rental.back.arbiter"), landlord: t("rental.back.landlord"), tenant: t("rental.back.tenant"), none: t("rental.back.none") },

    pill: {
      created: t("rental.pill.created"),
      month: (m: number, term: number) => t("rental.pill.month", { m, term }),
      proposal: t("rental.pill.proposal"),
      closed: (at: bigint) => t("rental.pill.closed", { date: day(at) }),
      disputed: t("rental.pill.disputed"),
      settled: t("rental.pill.settled"),
      cancelled: t("rental.pill.cancelled"),
    },

    banner: {
      fundTitle: (total: string) => h("rental.banner.fundTitle", { total }),
      fundBody: t("rental.banner.fundBody"),
      fundAction: (total: string) => t("rental.banner.fundAction", { total }),
      fundNote: t("rental.banner.fundNote"),
      waitFundTitle: h("rental.banner.waitFundTitle"),
      waitFundOwner: t("rental.banner.waitFundOwner"),
      waitFundOther: t("rental.banner.waitFundOther"),

      lockedTitle: (deposit: string, you: boolean) => h(you ? "rental.banner.lockedTitleYou" : "rental.banner.lockedTitle", { deposit }),
      payBody: (paidThrough: number, next: number, due: bigint) => t("rental.banner.payBody", { paid: paidThrough, next, due: day(due) }),
      payAction: (next: number, rent: string) => t("rental.banner.payAction", { next, rent }),
      payNote: t("rental.banner.payNote"),
      allPaidBody: (term: number) => t("rental.banner.allPaidBody", { months: months(term) }),
      returnedTitle: h("rental.banner.returnedTitle"),
      returnedBody: (days: number) => t("rental.banner.returnedBody", { days }),
      proposeAction: t("rental.banner.proposeAction"),

      collectTitle: (amount: string) => h("rental.banner.collectTitle", { amount }),
      collectBody: (fee: string | null) => (fee ? t("rental.banner.collectBodyFee", { fee }) : t("rental.banner.collectBodyNoFee")),
      collectAction: (month: number, amount: string) => t("rental.banner.collectAction", { month, amount }),
      paidOwnerTitle: (n: number, net: string) => h(n === 1 ? "rental.banner.paidOwnerTitle.one" : "rental.banner.paidOwnerTitle.other", { n, net }),
      runningTitle: h("rental.banner.runningTitle"),
      nextDueBody: (due: bigint) => t("rental.banner.nextDueBody", { due: day(due) }),
      allRentBody: t("rental.banner.allRentBody"),
      idleUntil: (due: bigint) => t("rental.banner.idleUntil", { date: day(due) }),

      noDisputeTitle: h("rental.banner.noDisputeTitle"),
      noDisputeBody: t("rental.banner.noDisputeBody"),
      nothingToRule: t("rental.banner.nothingToRule"),
      monthOf: (m: number, term: number) => t("rental.banner.monthOf", { m, term }),

      /** `by`: the proposer's role (model.ts Viewer). */
      proposedTitle: (by: string | null, back: string, kept: string) => h(`rental.banner.proposedTitle.${roleKey(by)}`, { back, kept }),
      proposedBody: (by: string | null, back: string, kept: string) => t(`rental.banner.proposed.${roleKey(by)}`, { back, kept }),
      replyBy: (at: bigint, owner: boolean) => t(owner ? "rental.banner.replyByOwner" : "rental.banner.replyBy", { date: day(at) }),
      replyAnytime: t("rental.banner.replyAnytime"),
      replyAction: t("rental.banner.replyAction"),
      yourProposalTitle: h("rental.banner.yourProposalTitle"),
      theyHaveUntil: (at: bigint) => t("rental.banner.theyHaveUntil", { date: day(at) }),
      theyDecide: t("rental.banner.theyDecide"),
      proposalWaitingTitle: h("rental.banner.proposalWaitingTitle"),

      claimTitle: (deposit: string) => h("rental.banner.claimTitle", { deposit }),
      claimBody: (days: number) => t("rental.banner.claimBody", { days }),
      claimAction: (deposit: string) => t("rental.banner.claimAction", { deposit }),
      closedOwnerTitle: (at: bigint) => h("rental.banner.closedOwnerTitle", { date: day(at) }),
      closedOwnerBody: (days: number, deposit: string) => t("rental.banner.closedOwnerBody", { days, deposit }),
      closedGone: t("rental.banner.closedGone"),
      closedOtherTitle: h("rental.banner.closedOtherTitle"),
      closedOtherBody: (deposit: string) => t("rental.banner.closedOtherBody", { deposit }),

      ruleTitle: h("rental.banner.ruleTitle"),
      ruleBody: (at: bigint) => t("rental.banner.ruleBody", { date: day(at) }),
      ruleAction: t("rental.banner.ruleAction"),
      deskDecidingTitle: h("rental.banner.deskDecidingTitle"),
      deskDecidingBody: (at: bigint) => t("rental.banner.deskDecidingBody", { date: day(at) }),
      deskLateTitle: h("rental.banner.deskLateTitle"),
      deskLateBody: t("rental.banner.deskLateBody"),
      deskLateAction: (deposit: string) => t("rental.banner.deskLateAction", { deposit }),

      settledTenantTitle: (back: string) => h("rental.banner.settledTenantTitle", { back }),
      settledOwnerTitle: (net: string) => h("rental.banner.settledOwnerTitle", { net }),
      settledTitle: h("rental.banner.settledTitle"),
      settledBody: t("rental.banner.settledBody"),
      cancelledTitle: h("rental.banner.cancelledTitle"),
      cancelledBody: t("rental.banner.cancelledBody"),

      nothing: t("rental.banner.nothing"),
      nothingLeft: t("rental.banner.nothingLeft"),
      oneConfirmation: t("rental.banner.oneConfirmation"),
    },

    monthsLabel: t("rental.monthsLabel"),
    month: (n: number) => t("rental.month", { n }),
    monthPaidOut: t("rental.monthPaidOut"),
    monthPaidIn: t("rental.monthPaidIn"),
    monthDue: (at: bigint) => t("rental.monthDue", { date: day(at) }),
    returnOn: (at: bigint) => t("rental.returnOn", { date: day(at) }),

    strip: {
      paidIn: (you: boolean) => t(you ? "rental.strip.paidInYou" : "rental.strip.paidIn"),
      escrow: t("rental.strip.escrow"),
      owner: (you: boolean) => t(you ? "rental.strip.ownerYou" : "rental.strip.owner"),
      vault: t("rental.strip.vault"),
      stillToPay: (rent: string) => t("rental.strip.stillToPay", { rent }),
      allPaidIn: t("rental.strip.allPaidIn"),
      gotBack: (v: string) => t("rental.strip.gotBack", { amount: v }),
      escrowEmpty: t("rental.strip.escrowEmpty"),
      escrowLocked: t("rental.strip.escrowLocked"),
      escrowAhead: t("rental.strip.escrowAhead"),
      escrowClaim: t("rental.strip.escrowClaim"),
      escrowDone: t("rental.strip.escrowDone"),
      afterFee: (fee: string) => t("rental.strip.afterFee", { fee }),
      feeLater: t("rental.strip.feeLater"),
      trust: t("rental.strip.trust"),
      fee: (pct: string) => t("rental.strip.fee", { pct }),
    },

    timeline: { title: h("rental.timeline"), sub: t("rental.timeline.sub"), none: t("rental.timeline.none"), payee: t("rental.timeline.payee") },

    ret: {
      title: h("rental.ret"),
      planned: (at: bigint) => t("rental.ret.planned", { date: day(at) }),
      photos: t("rental.ret.photos"),
      photosSub: t("rental.ret.photosSub"),
      split: t("rental.ret.split"),
      splitSub: t("rental.ret.splitSub"),
      reply: (days: number) => t("rental.ret.reply", { days }),
      replySub: t("rental.ret.replySub"),
      desk: (days: number) => t("rental.ret.desk", { days }),
      deskSub: t("rental.ret.deskSub"),
      back: t("rental.ret.back"),
      backSub: t("rental.ret.backSub"),
      by: (at: bigint) => t("rental.ret.by", { date: day(at) }),
      on: (at: bigint) => day(at),
      closed: (at: bigint) => t("rental.ret.closed", { date: day(at) }),
      now: t("rental.ret.now"),
      skipped: t("rental.ret.skipped"),
      ifDisputed: t("rental.ret.ifDisputed"),
      afterDeadline: t("rental.ret.afterDeadline"),
      later: t("rental.ret.later"),
    },
  };
}

export type RentalCopy = ReturnType<typeof rentalCopyFor>;

/** The rental page's copy in the visitor's language. */
export function useRentalCopy() {
  const t = useT();
  return useMemo(() => rentalCopyFor(t), [t]);
}
