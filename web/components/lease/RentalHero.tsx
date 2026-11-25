"use client";

import { ArrowLeft, ArrowRight, Check, ExternalLink, Lock, ShieldCheck, Store, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Amount, CopyButton, StatusBadge, useBaht } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { explorerLink } from "@/lib/chains";
import { LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import type { Scooter } from "@/lib/fleet";
import { shortAddress } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { JarArt, SafeArt } from "./Art";
import { useRentalCopy } from "./copy";
import { RENT_PERIOD, type Viewer } from "./model";
import { banner, monthCells, moneyFlow, type Banner, type BannerAction } from "./story";

const TONE_TEXT: Record<Banner["tone"], string> = { ok: "text-banner-ok", warn: "text-banner-warn", danger: "text-banner-danger", neutral: "text-banner-muted" };

/** The top of the rental page: what it is, the state in one sentence with the viewer's one action, and the money. */
export function RentalHero({ lease, viewer, events, chainId, scooter, wallet }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined; chainId: number; scooter?: Scooter; wallet: boolean }) {
  const baht = useBaht();
  const c = useRentalCopy();
  const i18n = useT();
  const b = banner(lease, viewer, events, baht, c);
  const scan = explorerLink(chainId, "address", lease.address);
  const t = lease.terms;
  const sub = [
    scooter?.location,
    c.ownerShort(shortAddress(t.landlord)),
    lease.startTime > BigInt(0) ? c.period(lease.startTime, lease.startTime + BigInt(t.termMonths) * RENT_PERIOD) : c.notStarted,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:items-end @2xl:justify-between">
        <div className="min-w-0">
          <Link href={viewer ? `/${viewer}` : "/app"} className="inline-flex items-center gap-1 text-sm text-subtle hover:underline">
            <ArrowLeft aria-hidden className="size-3.5" />
            {c.back[viewer ?? "none"]}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight @2xl:text-3xl" data-testid="rental-title">
            {scooter?.name ?? c.fallbackTitle}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{sub.join(" · ")}</p>
        </div>
        <div className="flex flex-col gap-1 text-sm @2xl:items-end">
          <span className="text-muted-foreground">{viewer ? <b className="text-foreground">{c.youAre[viewer]}</b> : c.readOnly(wallet)}</span>
          <span className="inline-flex items-center gap-1 text-xs text-subtle">
            {scan ? (
              <a href={scan} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2" data-testid="escrow-link">
                {c.escrowLink(shortAddress(lease.address), true)} <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : (
              <span className="font-mono" title={lease.address}>
                {c.escrowLink(shortAddress(lease.address), false)}
              </span>
            )}
            <CopyButton value={lease.address} label={i18n("rental.copyEscrow")} />
          </span>
        </div>
      </header>

      <section className="grid gap-5 rounded-2xl bg-banner p-5 text-banner-foreground shadow-sm @3xl:grid-cols-[minmax(0,1fr)_17rem] @3xl:p-6" data-testid="rental-banner" data-tone={b.tone}>
        <div className="min-w-0">
          <p className={cn("flex flex-wrap items-center gap-2 text-sm font-semibold", TONE_TEXT[b.tone])}>
            <StatusBadge status={lease.status} />
            {b.pill}
          </p>
          <h2 className="mt-2 text-2xl leading-tight font-semibold @2xl:text-3xl" data-testid="banner-title">
            {b.title}
          </h2>
          <p className="mt-2 max-w-2xl text-base text-banner-muted" data-testid="next-step">
            {b.body}
          </p>
          <Months lease={lease} />
        </div>
        <BannerActionView action={b.action} lease={lease} />
      </section>

      <MoneyStrip lease={lease} viewer={viewer} events={events} />
    </div>
  );
}

function Months({ lease }: { lease: LeaseData }) {
  const c = useRentalCopy();
  const cells = monthCells(lease);
  if (!cells.length) return null;
  const end = lease.startTime + BigInt(lease.terms.termMonths) * RENT_PERIOD;
  return (
    <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs text-banner-muted" aria-label={c.monthsLabel} data-testid="rental-months">
      {cells.map((m) => (
        <li key={m.n} className="min-w-20 flex-1" data-state={m.state}>
          <span className={cn("mb-1 block h-1.5 rounded-full", m.state === "out" ? "bg-banner-ok" : m.state === "in" ? "bg-banner-ok/50" : "bg-banner-line")} />
          <b className="text-banner-foreground">{c.month(m.n)}</b> {m.state === "out" ? c.monthPaidOut : m.state === "in" ? c.monthPaidIn : c.monthDue(m.due)}
        </li>
      ))}
      <li className="self-end">{c.returnOn(end)}</li>
    </ol>
  );
}

function BannerActionView({ action, lease }: { action: BannerAction; lease: LeaseData }) {
  const { send, pending } = useTx();
  const big = "h-auto min-h-12 w-full whitespace-normal bg-banner-foreground px-4 py-3 text-base font-semibold text-banner hover:bg-banner-muted";
  return (
    <div className="flex flex-col items-stretch justify-center gap-2 text-center" data-testid="banner-action" data-kind={action.kind}>
      {action.kind === "tx" ? (
        <Button
          className={big}
          disabled={!!pending}
          onClick={() => send(action.label, { address: lease.address, abi: rentalEscrowAbi, functionName: action.tx })}
          data-testid="banner-primary"
        >
          {action.label} <ArrowRight aria-hidden />
        </Button>
      ) : action.kind === "jump" ? (
        <Button asChild className={big}>
          <a href={`#act-${action.to}`} data-testid="banner-primary">
            {action.label} <ArrowRight aria-hidden />
          </a>
        </Button>
      ) : (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-banner-line px-4 py-3 text-sm text-banner-muted" data-testid="banner-idle">
          <Check aria-hidden className="size-4 shrink-0 text-banner-ok" />
          {action.label}
        </p>
      )}
      {action.kind !== "idle" && action.note && <p className="text-xs text-banner-muted">{action.note}</p>}
    </div>
  );
}

function MoneyStrip({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const baht = useBaht();
  const c = useRentalCopy();
  const t = lease.terms;
  const f = moneyFlow(events);
  const s = c.strip;
  const toPay = t.rentAmount * BigInt(t.termMonths - lease.monthsFunded);
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
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm" data-testid="money-strip">
      <div className="grid gap-3 @3xl:grid-cols-[1fr_auto_1.15fr_auto_1fr] @3xl:items-center">
        <Node icon={<UserRound aria-hidden className="size-4" />} who={s.paidIn(viewer === "tenant")} value={f.paidIn} note={settled ? s.gotBack(baht(f.backToRenter)) : lease.status !== LeaseStatus.Active ? "" : toPay > BigInt(0) ? s.stillToPay(baht(toPay)) : s.allPaidIn} />
        <Arrow />
        <Node
          icon={<Lock aria-hidden className="size-4" />}
          who={s.escrow}
          value={lease.balance}
          note={escrowNote}
          art={<SafeArt fill={lease.balance > BigInt(0) ? 0.6 : 0} />}
          className="rounded-xl border border-info-border bg-info-soft p-3"
          testId="strip-escrow"
        />
        <Arrow />
        <Node
          icon={<Store aria-hidden className="size-4" />}
          who={events?.some((e) => e.name === "PayeeSet") ? s.vault : s.owner(viewer === "landlord")}
          value={f.toOwner}
          note={f.fee > BigInt(0) ? s.afterFee(baht(f.fee)) : s.feeLater}
          art={f.fee > BigInt(0) ? <JarArt /> : undefined}
        />
      </div>
      <p className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        <span className="inline-flex items-start gap-2 font-semibold">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          {s.trust}
        </span>
        <span className="text-subtle @3xl:ml-auto">{s.fee((t.feeBps / 100).toFixed(0))}</span>
      </p>
    </section>
  );
}

function Node({ icon, who, value, note, art, className, testId }: { icon: ReactNode; who: string; value: bigint; note: string; art?: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)} data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {who}
        </p>
        <Amount value={value} size="lg" />
        <p className="mt-0.5 text-sm text-muted-foreground">{note}</p>
      </div>
      {art}
    </div>
  );
}

const Arrow = () => <ArrowRight aria-hidden className="hidden size-5 text-subtle @3xl:block" />;
