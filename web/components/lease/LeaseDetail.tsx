"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, AddressTag, Amount, Card, Countdown, Notice, Skeleton, useMoney } from "@/components/ui";
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
import { dateTimeIn } from "./copy";
import { EvidencePanel } from "./EvidencePanel";
import { FundingPanel, Stat } from "./FundingPanel";
import { viewerRole, type Viewer } from "./model";
import { MoveOutPanel } from "./MoveOutPanel";
import { RentPanel } from "./RentPanel";
import { RentalHero } from "./RentalHero";
import { ResolvePanel } from "./ResolvePanel";
import { ReturnPlan } from "./ReturnPlan";
import { Timeline } from "./Timeline";

/** Every escrow of the deployment (lowercase) and the newest rental: tells a stale link from a busy RPC. */
const knownLeases = (ix: ChainIndexResponse) => ({ escrows: new Set(ix.escrows.map((a) => a.toLowerCase())), latest: latestLease(ix)?.lease });

export function LeaseDetail({ address }: { address: Address }) {
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

  return (
    <div className="space-y-6 @container">
      <RentalHero lease={lease} viewer={viewer} events={events} chainId={chainId} scooter={scooter} wallet={!!me} />
      <ChainReadNotice
        error={eventsError}
        hasData={!!events}
        onRetry={() => refetchEvents()}
        retrying={eventsFetching}
        what={t("rental.detail.historyWhat")}
      />
      <div className="grid gap-6 @4xl:grid-cols-2">
        <Timeline lease={lease} events={events} chainId={chainId} unavailable={!!eventsError && !events} />
        <ReturnPlan lease={lease} events={events} />
      </div>
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
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
          {lease.status === LeaseStatus.Settled && <SettledSummary events={events} />}
          {live && (
            <div id="act-rent" className="scroll-mt-4">
              <RentPanel lease={lease} viewer={viewer} />
            </div>
          )}
          <div id="act-return" className="scroll-mt-4 empty:hidden">
            <MoveOutPanel lease={lease} viewer={viewer} events={events} />
          </div>
          <EvidencePanel lease={lease} viewer={viewer} events={events} />
        </div>
        <aside className="space-y-6">
          <Terms lease={lease} chainId={chainId} viewer={viewer} />
        </aside>
      </div>
    </div>
  );
}

function Terms({ lease, chainId, viewer }: { lease: LeaseData; chainId: number; viewer: Viewer }) {
  const t = lease.terms;
  const money = useMoney();
  const i = useT();
  const fee = (t.rentAmount * BigInt(t.feeBps)) / BigInt(10_000);
  const you = i("rental.terms.you");
  return (
    <>
      <Card title={i.h("rental.terms")}>
        <dl className="space-y-3 text-sm">
          <Row label={i("rental.terms.period")}>{i("rental.terms.periodValue", { n: t.termMonths })}</Row>
          {lease.startTime > BigInt(0) && <Row label={i("rental.terms.started")}>{dateTimeIn(i)(lease.startTime)}</Row>}
          <Row label={i("rental.terms.replyWindow")}>{i("rental.terms.days", { n: t.responseWindow / 86400 })}</Row>
          <Row label={i("rental.terms.deskDeadline")}>{i("rental.terms.days", { n: t.arbiterWindow / 86400 })}</Row>
          <div>
            <Row label={i("rental.terms.fee")}>{money(fee)}</Row>
            <p className="mt-0.5 text-right text-xs text-subtle">
              {i(lease.feeCharged ? "rental.terms.feeOncePaid" : "rental.terms.feeOnce", { pct: (t.feeBps / 100).toFixed(0) })}
            </p>
          </div>
          <Row label={i("rental.terms.owner")}><AddressTag address={t.landlord} chainId={chainId} label={viewer === "landlord" ? you : undefined} /></Row>
          <Row label={i("rental.terms.renter")}><AddressTag address={t.tenant} chainId={chainId} label={viewer === "tenant" ? you : undefined} /></Row>
          <Row label={i("rental.terms.desk")}><AddressTag address={t.arbiter} chainId={chainId} label={viewer === "arbiter" ? you : undefined} /></Row>
          <Row label={i("rental.terms.escrow")}><AddressTag address={lease.address} chainId={chainId} /></Row>
        </dl>
      </Card>
    </>
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
      <p className="mb-4 text-sm text-muted-foreground">{t("rental.cancel.body")}</p>
      <ActionButton variant="danger" busy={pending === label} onClick={() => send(label, { address: lease.address, abi: rentalEscrowAbi, functionName: "cancel" })}>
        {t("rental.cancel.button")}
      </ActionButton>
    </Card>
  );
}

function SettledSummary({ events }: { events: ReturnType<typeof useLeaseEvents>["data"] }) {
  const t = useT();
  const s = events?.find((e) => e.name === "Settled");
  if (!s) return null;
  const a = s.args as Record<string, bigint>;
  return (
    <Card title={t.h("rental.settlement")}>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="settlement">
        <Stat label={t("rental.settlement.renter")}>
          <Amount value={a.tenantRefund + a.rentToTenant} />
        </Stat>
        <Stat label={t("rental.settlement.owner")}>
          <Amount value={a.landlordClaim + a.rentToLandlord - a.fee} />
        </Stat>
      </div>
    </Card>
  );
}
