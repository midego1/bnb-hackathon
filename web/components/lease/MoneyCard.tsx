"use client";

import { ArrowDown, Lock, ShieldCheck, Store, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Amount, Card, PriceSourceBadge, useBaht } from "@/components/ui";
import { atlasBadge } from "@/lib/atlas";
import { LeaseStatus } from "@/lib/contracts";
import { formatFiat } from "@/lib/fiat";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useT } from "@/lib/i18n/client";
import { perIn } from "@/lib/rentals";
import { usePrices } from "@/lib/usePrices";
import { cn } from "@/lib/utils";
import { useRentalCopy } from "./copy";
import type { Viewer } from "./model";
import { feeOf, moneyFlow } from "./story";

/**
 * The page's one place for money: where it is now (renter, this rental's escrow, owner), the agreed amounts (deposit,
 * rent per period, what starts the rental, the one-time fee) and the exchange rate with its source and time, once.
 * Baht first; USD and the exact USDT under each amount.
 */
export function MoneyCard({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const baht = useBaht();
  const c = useRentalCopy();
  const i = useT();
  const t = lease.terms;
  const f = moneyFlow(events);
  const s = c.strip;
  const toPay = t.rentAmount * BigInt(t.termPeriods - lease.periodsFunded);
  const settled = lease.status === LeaseStatus.Settled;
  const escrowNote =
    lease.status === LeaseStatus.Created
      ? s.escrowEmpty
      : settled || lease.status === LeaseStatus.Cancelled
        ? s.escrowDone
        : lease.status === LeaseStatus.MoveOut && lease.timeoutAt > BigInt(0) && lease.chainNow >= lease.timeoutAt
          ? s.escrowClaim
          : lease.balance > t.depositAmount
            ? s.escrowAhead
            : s.escrowLocked;
  const per = perIn(i, t.rentPeriod);
  return (
    <div data-testid="money-strip">
    <Card title={i.h("rental.money")} aside={<PriceSourceBadge />}>
      <h3 className="mb-2 text-xs font-medium text-subtle">{i("rental.money.now")}</h3>
      {/* Once settled this is the final split: what the renter got back and what the owner received. */}
      <ol data-testid={events?.some((e) => e.name === "Settled") ? "settlement" : undefined}>
        <Node icon={<UserRound aria-hidden className="size-4" />} who={s.paidIn(viewer === "tenant")} value={f.paidIn} note={settled ? s.gotBack(baht(f.backToRenter)) : lease.status !== LeaseStatus.Active ? "" : toPay > BigInt(0) ? s.stillToPay(baht(toPay)) : s.allPaidIn} />
        <Arrow />
        <Node icon={<Lock aria-hidden className="size-4" />} who={s.escrow} value={lease.balance} note={escrowNote} className="-mx-2 rounded-xl border border-info-border bg-info-soft px-2 py-2" testId="strip-escrow" />
        <Arrow />
        <Node
          icon={<Store aria-hidden className="size-4" />}
          who={events?.some((e) => e.name === "PayeeSet") ? s.vault : s.owner(viewer === "landlord")}
          value={f.toOwner}
          note={f.fee > BigInt(0) ? s.afterFee(baht(f.fee)) : s.feeLater}
        />
      </ol>
      <p className="mt-3 flex items-start gap-2 text-sm font-medium">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        {s.trust}
      </p>

      <h3 className="mt-5 mb-2 border-t border-border pt-4 text-xs font-medium text-subtle">{i("rental.money.agreed")}</h3>
      <dl className="space-y-2.5 text-sm">
        <Row label={i("rental.fund.deposit")} value={t.depositAmount} />
        <Row label={i("rental.money.rent", { per })} note={i("rental.money.periods", { n: t.termPeriods })} value={t.rentAmount} />
        <Row label={i("rental.money.start")} note={i("rental.money.startNote", { per })} value={t.depositAmount + t.rentAmount} strong />
        <Row label={i("rental.terms.fee")} note={i(lease.feeCharged ? "rental.terms.feeOncePaid" : "rental.terms.feeOnce")} value={feeOf(lease)} />
      </dl>
      <Rate />
    </Card>
    </div>
  );
}

function Node({ icon, who, value, note, className, testId }: { icon: ReactNode; who: string; value: bigint; note: string; className?: string; testId?: string }) {
  return (
    <li className={cn("flex items-start justify-between gap-3", className)} data-testid={testId}>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {who}
        </p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      <Amount value={value} size="lg" className="shrink-0 items-end text-right" />
    </li>
  );
}

const Arrow = () => (
  <li aria-hidden className="py-1 pl-0.5">
    <ArrowDown className="size-4 text-subtle" />
  </li>
);

function Row({ label, note, value, strong }: { label: string; note?: string; value: bigint; strong?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3", strong && "rounded-lg bg-muted px-2 py-2 -mx-2")}>
      <dt className={cn("min-w-0", strong && "font-semibold")}>
        {label}
        {note && <span className="block text-xs font-normal text-subtle">{note}</span>}
      </dt>
      <dd className="shrink-0">
        <Amount value={value} className="items-end text-right" />
      </dd>
    </div>
  );
}

/** The rate every baht and dollar figure on the page uses, with the time it was read. */
function Rate() {
  const { prices } = usePrices();
  const t = useT();
  const rate = prices?.rates.USDT;
  if (!prices || !rate) return null;
  const time = new Date(prices.updatedAt).toLocaleTimeString(t.lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <p className="mt-4 border-t border-border pt-3 text-xs text-subtle tabular-nums" data-testid="money-rate">
      {t("rental.money.rate", { thb: formatFiat(rate.THB, "THB"), usd: formatFiat(rate.USD, "USD"), source: t(`ui.source.${prices.source}.text`), time })}
      <AtlasLine />
    </p>
  );
}

/** "Priced by Atlas · updated N s ago · consensus 0.94 HEALTHY": the Atlas BNB/USD feed that guards Pay with BNB. */
function AtlasLine() {
  const { prices } = usePrices();
  const t = useT();
  const a = prices?.atlas;
  if (!a?.updatedAt) return null;
  const b = atlasBadge(a);
  return (
    <span className="block" data-testid="atlas-badge" data-ok={a.ok} title={a.reason}>
      {t("rental.money.atlas", { age: b.age ?? 0 })}
      {b.score && b.status && t("rental.money.atlasConsensus", { score: b.score, status: b.status })}
    </span>
  );
}
