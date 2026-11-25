"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, AddressTag, Amount, Card, Countdown, Notice, Skeleton, statusMeta, useMoney } from "@/components/ui";
import { useFleet } from "@/components/roles/shared";
import { chainName } from "@/lib/chains";
import { LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { latestLease, type ChainIndexResponse } from "@/lib/chainIndex";
import { formatDate } from "@/lib/format";
import { useChainIndex } from "@/lib/hooks/useChainIndex";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useLease, type LeaseData } from "@/lib/hooks/useLease";
import { useLeaseEvents } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
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

  if (!deployment) return <Notice kind="warn">KeyEscrow is not deployed on {chainName(chainId)}. Switch your wallet to the network this rental lives on.</Notice>;
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  // A link to a rental of an older deployment (the testnet contracts were redeployed): not an error, point to a live one.
  if ((error || !lease) && known && !known.escrows.has(address.toLowerCase()))
    return (
      <Notice kind="info">
        <span data-testid="lease-gone">
          This demo rental no longer exists on {chainName(chainId)}.{" "}
          {known.latest ? (
            <Link href={`/lease/${known.latest}`} className="font-medium underline">
              Open the latest one
            </Link>
          ) : (
            <Link href="/app" className="font-medium underline">
              Open the app
            </Link>
          )}
        </span>
      </Notice>
    );
  if (error || !lease)
    return (
      <div className="space-y-3">
        <Notice kind="error">
          No KeyEscrow rental could be read at {address} on {chainName(chainId)}. Check the link and the network your wallet is on; if the
          public RPC was just busy, retry.
        </Notice>
        <button type="button" onClick={() => refetch()} disabled={isFetching} data-testid="chain-retry" className="rounded-md border border-border-strong px-3 py-1.5 text-sm">
          {isFetching ? "Retrying…" : "Retry now"}
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
        what="this rental's history"
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
  const fee = (t.rentAmount * BigInt(t.feeBps)) / BigInt(10_000);
  return (
    <>
      <Card title="Terms">
        <dl className="space-y-3 text-sm">
          <Row label="Rental period">{t.termMonths} months</Row>
          {lease.startTime > BigInt(0) && <Row label="Started">{formatDate(lease.startTime)}</Row>}
          <Row label="Owner reply window">{t.responseWindow / 86400} days</Row>
          <Row label="Dispute desk deadline">{t.arbiterWindow / 86400} days</Row>
          <div>
            <Row label="KeyEscrow fee">{money(fee)}</Row>
            <p className="mt-0.5 text-right text-xs text-subtle">
              Once: {(t.feeBps / 100).toFixed(0)}% of one month&apos;s rent, {lease.feeCharged ? "already paid" : "taken from the owner's first payout"}
            </p>
          </div>
          <Row label="Owner"><AddressTag address={t.landlord} chainId={chainId} label={viewer === "landlord" ? "you" : undefined} /></Row>
          <Row label="Renter"><AddressTag address={t.tenant} chainId={chainId} label={viewer === "tenant" ? "you" : undefined} /></Row>
          <Row label="Dispute desk"><AddressTag address={t.arbiter} chainId={chainId} label={viewer === "arbiter" ? "you" : undefined} /></Row>
          <Row label="Escrow"><AddressTag address={lease.address} chainId={chainId} /></Row>
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
  const passed = lease.chainNow >= lease.arbiterDeadline;
  return (
    <Card title={viewer === "arbiter" ? "Your deadline" : "Waiting for the dispute desk"}>
      <p className="text-sm text-muted-foreground">
        {statusMeta[LeaseStatus.Disputed].hint} Rent is still paid out as it comes due.{" "}
        {passed ? (
          <>The dispute desk missed its deadline ({formatDate(lease.arbiterDeadline)}). Anyone can now close the dispute and return the full deposit to the renter.</>
        ) : (
          <>
            Ruling due by {formatDate(lease.arbiterDeadline)} (<Countdown target={lease.arbiterDeadline} clock={lease} />). If there is no
            ruling by then, the full deposit goes back to the renter.
          </>
        )}
      </p>
      <ActionButton
        className="mt-4"
        variant="secondary"
        busy={pending === "Claim arbiter timeout"}
        disabledReason={passed ? null : `Available after ${formatDate(lease.arbiterDeadline)}: the dispute desk still has time to rule.`}
        onClick={() => send("Claim arbiter timeout", { address: lease.address, abi: rentalEscrowAbi, functionName: "claimArbiterTimeout" })}
        data-testid="claim-arbiter-timeout"
      >
        Return full deposit to renter
      </ActionButton>
    </Card>
  );
}

function CancelOffer({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
  return (
    <Card title="Waiting for the renter">
      <p className="mb-4 text-sm text-muted-foreground">
        Send this page&apos;s link to your renter. Once they fund the deposit and first month&apos;s rent, the rental starts and rent is paid
        out to you every month. You can withdraw the offer until then; nothing has been paid yet.
      </p>
      <ActionButton variant="danger" busy={pending === "Cancel offer"} onClick={() => send("Cancel offer", { address: lease.address, abi: rentalEscrowAbi, functionName: "cancel" })}>
        Withdraw offer
      </ActionButton>
    </Card>
  );
}

function SettledSummary({ events }: { events: ReturnType<typeof useLeaseEvents>["data"] }) {
  const s = events?.find((e) => e.name === "Settled");
  if (!s) return null;
  const a = s.args as Record<string, bigint>;
  return (
    <Card title="Final settlement">
      <div className="grid gap-3 sm:grid-cols-2" data-testid="settlement">
        <Stat label="Renter received">
          <Amount value={a.tenantRefund + a.rentToTenant} />
        </Stat>
        <Stat label="Owner received">
          <Amount value={a.landlordClaim + a.rentToLandlord - a.fee} />
        </Stat>
      </div>
    </Card>
  );
}
