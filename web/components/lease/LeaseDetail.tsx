"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { CalendarDays, Receipt, Reply, Scale } from "lucide-react";
import { DepositProtection } from "@/components/risk/DepositRiskPanel";
import { ActionButton, AddressTag, Card, Countdown, Notice, Skeleton } from "@/components/ui";
import { useFleet } from "@/components/roles/shared";
import { chainName } from "@/lib/chains";
import { LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { latestLease, type ChainIndexResponse } from "@/lib/chainIndex";
import { useChainIndex } from "@/lib/hooks/useChainIndex";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useLease, type LeaseData } from "@/lib/hooks/useLease";
import { useLeaseEvents } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { dateTimeIn, useRentalCopy } from "./copy";
import { EvidencePanel } from "./EvidencePanel";
import { FundingPanel } from "./FundingPanel";
import { Lifecycle } from "./Lifecycle";
import { viewerRole, type Viewer } from "./model";
import { countIn, perIn } from "@/lib/rentals";
import { MoneyCard } from "./MoneyCard";
import { MoveOutPanel } from "./MoveOutPanel";
import { RentPanel } from "./RentPanel";
import { RentalBanner, RentalHeader } from "./RentalHero";
import { ResolvePanel } from "./ResolvePanel";

/** Every escrow of the deployment (lowercase) and the newest rental: tells a stale link from a busy RPC. */
const knownLeases = (ix: ChainIndexResponse) => ({ escrows: new Set(ix.escrows.map((a) => a.toLowerCase())), latest: latestLease(ix)?.lease });

/** `pinAction`: on a phone the banner's action stays at the bottom of the screen (the rental page; not inside /demo). */
export function LeaseDetail({ address, pinAction }: { address: Address; pinAction?: boolean }) {
  const { address: me } = useAccount();
  const { chainId, deployment } = useDeployment();
  const { data: lease, error, isLoading, refetch, isFetching } = useLease(deployment ? address : undefined);
  const { data: known } = useChainIndex(knownLeases);
  const { data: events, error: eventsError, refetch: refetchEvents, isFetching: eventsFetching } = useLeaseEvents(deployment ? address : undefined);
  const { data: fleet } = useFleet();
  const t = useT();

  if (!deployment) return <Notice kind="warn">{t("rental.detail.notDeployed", { chain: chainName(chainId) })}</Notice>;
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  // A link to a rental of an older deployment (the testnet contracts were redeployed): not an error, point to a live one.
  if ((error || !lease) && known && !known.escrows.has(address.toLowerCase()))
    return (
      <Notice kind="info">
        <span data-testid="lease-gone">
          {t("rental.detail.gone", { chain: chainName(chainId) })}{" "}
          {known.latest ? (
            <Link href={`/lease/${known.latest}`} className="font-medium underline">
              {t("rental.detail.openLatest")}
            </Link>
          ) : (
            <Link href="/app" className="font-medium underline">
              {t("rental.detail.openApp")}
            </Link>
          )}
        </span>
      </Notice>
    );
  if (error || !lease)
    return (
      <div className="space-y-3">
        <Notice kind="error">
          {t("rental.detail.unreadable", { address, chain: chainName(chainId) })}
        </Notice>
        <button type="button" onClick={() => refetch()} disabled={isFetching} data-testid="chain-retry" className="rounded-md border border-border-strong px-3 py-1.5 text-sm">
          {isFetching ? t("rental.detail.retrying") : t("rental.detail.retryNow")}
        </button>
      </div>
    );

  const viewer = viewerRole(lease, me);
  const live = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;
  const scooter = fleet?.scooters.find((x) => x.rentals.some((r) => r.toLowerCase() === address.toLowerCase()));

  const deposited = lease.status !== LeaseStatus.Settled && lease.status !== LeaseStatus.Cancelled;

  return (
    <div className="space-y-6 @container">
      <RentalHeader lease={lease} viewer={viewer} chainId={chainId} scooter={scooter} wallet={!!me} />
      {/* Phone: one column in reading order. Desktop: the side column (money, protection, agreement) beside both main blocks. */}
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_21rem] @4xl:grid-rows-[auto_1fr]">
        <div className="@container flex min-w-0 flex-col gap-6 @4xl:col-start-1">
          <RentalBanner lease={lease} viewer={viewer} events={events} pinAction={pinAction} />
          {lease.status === LeaseStatus.Created && viewer === "tenant" && (
            <div id="act-fund" className="scroll-mt-4">
              <FundingPanel lease={lease} />
            </div>
          )}
          {lease.status === LeaseStatus.Created && viewer === "landlord" && <CancelOffer lease={lease} />}
          {lease.status === LeaseStatus.Disputed && viewer === "arbiter" && (
            <div id="act-rule" className="scroll-mt-4">
              <ResolvePanel lease={lease} />
            </div>
          )}
          {lease.status === LeaseStatus.Disputed && <ArbiterDeadline lease={lease} viewer={viewer} />}
          {live && (
            <div id="act-rent" className="scroll-mt-4">
              <RentPanel lease={lease} viewer={viewer} />
            </div>
          )}
          <div id="act-return" className="scroll-mt-4 empty:hidden">
            <MoveOutPanel lease={lease} viewer={viewer} events={events} />
          </div>
        </div>
        <aside className="min-w-0 space-y-6 @4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-1">
          <MoneyCard lease={lease} viewer={viewer} events={events} />
          {deposited && <DepositProtection deposit={lease.terms.depositAmount} rentalDays={(lease.terms.termPeriods * lease.terms.rentPeriod) / 86400} />}
          <Agreement lease={lease} chainId={chainId} viewer={viewer} />
        </aside>
        <div className="min-w-0 space-y-6 @4xl:col-start-1">
          <ChainReadNotice
            error={eventsError}
            hasData={!!events}
            onRetry={() => refetchEvents()}
            retrying={eventsFetching}
            what={t("rental.detail.historyWhat")}
          />
          <Lifecycle lease={lease} events={events} chainId={chainId} unavailable={!!eventsError && !events} />
          <EvidencePanel lease={lease} viewer={viewer} events={events} />
        </div>
      </div>
    </div>
  );
}

/** The agreement as it runs: how long, each deadline and what a missed one means, the fee, and who is who. */
function Agreement({ lease, chainId, viewer }: { lease: LeaseData; chainId: number; viewer: Viewer }) {
  const t = lease.terms;
  const i = useT();
  const c = useRentalCopy();
  const you = i("rental.terms.you");
  const end = lease.startTime + BigInt(t.termPeriods) * BigInt(t.rentPeriod);
  const clauses = [
    { icon: CalendarDays, title: i("rental.terms.runs", { months: countIn(i, t.termPeriods, t.rentPeriod), per: perIn(i, t.rentPeriod) }), sub: lease.startTime > BigInt(0) ? c.period(lease.startTime, end) : c.notStarted },
    { icon: Reply, title: i("rental.terms.reply", { n: t.responseWindow / 86400 }), sub: i("rental.terms.replySub") },
    { icon: Scale, title: i("rental.terms.deskRule", { n: t.arbiterWindow / 86400 }), sub: i("rental.terms.deskSub") },
    { icon: Receipt, title: i("rental.terms.feeRule", { pct: (t.feeBps / 100).toFixed(0) }), sub: i("rental.terms.feeSub") },
  ];
  return (
    <Card title={i.h("rental.terms")}>
      <ol className="space-y-3 text-sm" data-testid="agreement">
        {clauses.map(({ icon: Icon, title, sub }) => (
          <li key={title} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <Icon aria-hidden className="mt-0.5 size-4 text-subtle" />
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
          </li>
        ))}
      </ol>
      <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <Row label={i("rental.terms.owner")}><AddressTag address={t.landlord} chainId={chainId} label={viewer === "landlord" ? you : undefined} /></Row>
        <Row label={i("rental.terms.renter")}><AddressTag address={t.tenant} chainId={chainId} label={viewer === "tenant" ? you : undefined} /></Row>
        <Row label={i("rental.terms.desk")}><AddressTag address={t.arbiter} chainId={chainId} label={viewer === "arbiter" ? you : undefined} /></Row>
        <Row label={i("rental.terms.escrow")}><AddressTag address={lease.address} chainId={chainId} /></Row>
      </dl>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** Dispute clock: arbiter must rule before the deadline; afterwards anyone returns the full deposit to the renter. */
function ArbiterDeadline({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { send, pending } = useTx();
  const t = useT();
  const date = dateTimeIn(t)(lease.arbiterDeadline);
  const passed = lease.chainNow >= lease.arbiterDeadline;
  const label = t("rental.deadline.tx");
  return (
    <Card title={t.h(viewer === "arbiter" ? "rental.deadlineYours" : "rental.deadlineWaiting")}>
      <p className="text-sm text-muted-foreground">
        {t("ui.status.disputed.hint")} {t("rental.deadline.rentStill")}{" "}
        {passed ? (
          <>{t("rental.deadline.missed", { date })}</>
        ) : (
          <>
            {t("rental.deadline.dueBy", { date })}
            <Countdown target={lease.arbiterDeadline} clock={lease} />
            {t("rental.deadline.dueByAfter")}
          </>
        )}
      </p>
      <ActionButton
        className="mt-4"
        variant="secondary"
        busy={pending === label}
        disabledReason={passed ? null : t("rental.deadline.availableAfter", { date })}
        onClick={() => send(label, { address: lease.address, abi: rentalEscrowAbi, functionName: "claimArbiterTimeout" })}
        data-testid="claim-arbiter-timeout"
      >
        {t("rental.deadline.button")}
      </ActionButton>
    </Card>
  );
}

function CancelOffer({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
  const t = useT();
  const label = t("rental.cancel.tx");
  return (
    <Card title={t.h("rental.waitingRenter")}>
      <p className="mb-4 text-sm text-muted-foreground">{t("rental.cancel.body", { per: perIn(t, lease.terms.rentPeriod) })}</p>
      <ActionButton variant="danger" busy={pending === label} onClick={() => send(label, { address: lease.address, abi: rentalEscrowAbi, functionName: "cancel" })}>
        {t("rental.cancel.button")}
      </ActionButton>
    </Card>
  );
}
