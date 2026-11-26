"use client";

import { ArrowLeft, ArrowRight, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { CopyButton, StatusBadge, useBaht } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { explorerLink } from "@/lib/chains";
import { rentalEscrowAbi } from "@/lib/contracts";
import type { Scooter } from "@/lib/fleet";
import { shortAddress } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useRentalCopy } from "./copy";
import { type Viewer } from "./model";
import { banner, monthCells, type Banner, type BannerAction } from "./story";

const TONE_TEXT: Record<Banner["tone"], string> = { ok: "text-banner-ok", warn: "text-banner-warn", danger: "text-banner-danger", neutral: "text-banner-muted" };

/** What it is, who is looking, and the escrow's address. */
export function RentalHeader({ lease, viewer, chainId, scooter, wallet }: { lease: LeaseData; viewer: Viewer; chainId: number; scooter?: Scooter; wallet: boolean }) {
  const c = useRentalCopy();
  const i18n = useT();
  const scan = explorerLink(chainId, "address", lease.address);
  const t = lease.terms;
  const sub = [
    scooter?.location,
    c.ownerShort(shortAddress(t.landlord)),
    lease.startTime > BigInt(0) ? c.period(lease.startTime, lease.startTime + BigInt(t.termPeriods) * BigInt(t.rentPeriod)) : c.notStarted,
  ].filter(Boolean);

  return (
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
  );
}

/** The state in one sentence with the viewer's one action: the block the rest of the page supports. */
export function RentalBanner({ lease, viewer, events, pinAction }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined; pinAction?: boolean }) {
  const baht = useBaht();
  const c = useRentalCopy();
  const b = banner(lease, viewer, events, baht, c);
  return (
    <section className="grid gap-5 rounded-2xl bg-banner p-5 text-banner-foreground shadow-sm @2xl:grid-cols-[minmax(0,1fr)_16rem] @2xl:p-6" data-testid="rental-banner" data-tone={b.tone}>
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
      <BannerActionView action={b.action} lease={lease} pin={pinAction && b.action.kind !== "idle"} />
    </section>
  );
}

function Months({ lease }: { lease: LeaseData }) {
  const c = useRentalCopy();
  const cells = monthCells(lease);
  if (!cells.length) return null;
  const end = lease.startTime + BigInt(lease.terms.termPeriods) * BigInt(lease.terms.rentPeriod);
  return (
    <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs text-banner-muted" aria-label={c.monthsLabel} data-testid="rental-months">
      {cells.map((m) => (
        <li key={m.n} className="min-w-20 flex-1" data-state={m.state}>
          <span className={cn("mb-1 block h-1.5 rounded-full", m.state === "out" ? "bg-banner-ok" : m.state === "in" ? "bg-banner-ok/50" : "bg-banner-line")} />
          <b className="text-banner-foreground">{c.month(m.n, lease.terms.rentPeriod)}</b> {m.state === "out" ? c.monthPaidOut : m.state === "in" ? c.monthPaidIn : c.monthDue(m.due)}
        </li>
      ))}
      <li className="self-end">{c.returnOn(end)}</li>
    </ol>
  );
}

function BannerActionView({ action, lease, pin }: { action: BannerAction; lease: LeaseData; pin?: boolean }) {
  const { send, pending } = useTx();
  const big = "h-auto min-h-12 w-full whitespace-normal bg-banner-foreground px-4 py-3 text-base font-semibold text-banner hover:bg-banner-muted";
  return (
    <div
      // On a phone the one action stays in reach: a bar at the bottom of the screen, with room for the Ask AI bubble at its right.
      className={cn(
        "flex flex-col items-stretch justify-center gap-2 text-center",
        pin && "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:border-t max-sm:border-banner-line max-sm:bg-banner max-sm:pt-2 max-sm:pr-[4.5rem] max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-sm:pl-3",
      )}
      data-testid="banner-action"
      data-kind={action.kind}
    >
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
      {action.kind !== "idle" && action.note && <p className={cn("text-xs text-banner-muted", pin && "max-sm:hidden")}>{action.note}</p>}
    </div>
  );
}
