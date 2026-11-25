"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { ActionButton, AddressTag, Amount, Card, Countdown, Notice, PriceSourceBadge, Skeleton, StatusBadge, statusMeta, useMoney } from "@/components/ui";
import { chainName, explorerLink } from "@/lib/chains";
import { LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { formatDate } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useLease, type LeaseData } from "@/lib/hooks/useLease";
import { useLeaseEvents } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { EvidencePanel } from "./EvidencePanel";
import { FundingPanel, Stat } from "./FundingPanel";
import { nextStep, roleName, viewerRole, type Viewer } from "./model";
import { MoveOutPanel } from "./MoveOutPanel";
import { RentPanel } from "./RentPanel";
import { ResolvePanel } from "./ResolvePanel";
import { Timeline } from "./Timeline";

export function LeaseDetail({ address }: { address: Address }) {
  const { address: me } = useAccount();
  const { chainId, deployment } = useDeployment();
  const { data: lease, error, isLoading } = useLease(deployment ? address : undefined);
  const { data: events, error: eventsError } = useLeaseEvents(deployment ? address : undefined);

  if (!deployment) return <Notice kind="warn">KeyEscrow is not deployed on {chainName(chainId)}. Switch your wallet to the network this lease lives on.</Notice>;
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (error || !lease)
    return <Notice kind="error">No KeyEscrow lease found at {address} on {chainName(chainId)}. Check the link and the network your wallet is on.</Notice>;

  const viewer = viewerRole(lease, me);
  const scan = explorerLink(chainId, "address", address);
  const live = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-subtle">
            <Link href={viewer ? `/${viewer}` : "/"} className="hover:underline">
              ← {viewer === "arbiter" ? "Dispute desk" : viewer === "landlord" ? "Landlord: my leases" : viewer === "tenant" ? "Tenant: my leases" : "Home"}
            </Link>
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            Lease <span className="font-mono text-lg">{address.slice(0, 10)}…</span>
            <StatusBadge status={lease.status} />
          </h1>
          <p className="mt-1 text-sm text-muted" data-testid="next-step">
            {nextStep(lease, viewer)}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 text-sm sm:items-end">
          {viewer ? (
            <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium">You are the {roleName(viewer)}</span>
          ) : (
            <span className="text-xs text-subtle">
              {me ? "This wallet is not part of this lease, so the page is read-only." : "Connect a wallet to act on this lease. Until then it is read-only."}
            </span>
          )}
          {scan && (
            <a href={scan} target="_blank" rel="noreferrer" className="text-xs underline">
              View escrow on BscScan
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {lease.status === LeaseStatus.Created && viewer === "tenant" && <FundingPanel lease={lease} />}
          {lease.status === LeaseStatus.Created && viewer === "landlord" && <CancelOffer lease={lease} />}
          {lease.status === LeaseStatus.Disputed && viewer === "arbiter" && <ResolvePanel lease={lease} />}
          {lease.status === LeaseStatus.Disputed && <ArbiterDeadline lease={lease} viewer={viewer} />}
          {lease.status === LeaseStatus.Settled && <SettledSummary events={events} />}
          {live && <RentPanel lease={lease} viewer={viewer} />}
          <MoveOutPanel lease={lease} viewer={viewer} events={events} />
          <EvidencePanel lease={lease} viewer={viewer} events={events} />
          <Timeline lease={lease} events={events} chainId={chainId} unavailable={!!eventsError && !events} />
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
      <Card title="In escrow now" aside={<PriceSourceBadge />}>
        <Amount value={lease.balance} size="lg" />
        <div className="mt-4 grid gap-3">
          <Stat label="Deposit">
            <Amount value={t.depositAmount} />
          </Stat>
          <Stat label="Rent / month">
            <Amount value={t.rentAmount} />
          </Stat>
        </div>
      </Card>
      <Card title="Terms">
        <dl className="space-y-3 text-sm">
          <Row label="Term">{t.termMonths} months</Row>
          {lease.startTime > BigInt(0) && <Row label="Started">{formatDate(lease.startTime)}</Row>}
          <Row label="Landlord reply window">{t.responseWindow / 86400} days</Row>
          <Row label="Dispute desk deadline">{t.arbiterWindow / 86400} days</Row>
          <div>
            <Row label="KeyEscrow fee">{money(fee)}</Row>
            <p className="mt-0.5 text-right text-xs text-subtle">
              Once: {(t.feeBps / 100).toFixed(0)}% of one month&apos;s rent, {lease.feeCharged ? "already paid" : "taken from the landlord's first payout"}
            </p>
          </div>
          <Row label="Landlord"><AddressTag address={t.landlord} chainId={chainId} label={viewer === "landlord" ? "you" : undefined} /></Row>
          <Row label="Tenant"><AddressTag address={t.tenant} chainId={chainId} label={viewer === "tenant" ? "you" : undefined} /></Row>
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

/** Dispute clock: arbiter must rule before the deadline; afterwards anyone returns the full deposit to the tenant. */
function ArbiterDeadline({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { send, pending } = useTx();
  const passed = lease.chainNow >= lease.arbiterDeadline;
  return (
    <Card title={viewer === "arbiter" ? "Your deadline" : "Waiting for the dispute desk"}>
      <p className="text-sm text-muted">
        {statusMeta[LeaseStatus.Disputed].hint} Rent is still paid out as it comes due.{" "}
        {passed ? (
          <>The dispute desk missed its deadline ({formatDate(lease.arbiterDeadline)}). Anyone can now close the dispute and return the full deposit to the tenant.</>
        ) : (
          <>
            Ruling due by {formatDate(lease.arbiterDeadline)} (<Countdown target={lease.arbiterDeadline} clock={lease} />). If there is no
            ruling by then, the full deposit goes back to the tenant.
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
        Return full deposit to tenant
      </ActionButton>
    </Card>
  );
}

function CancelOffer({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
  return (
    <Card title="Waiting for the tenant">
      <p className="mb-4 text-sm text-muted">
        Send this page&apos;s link to your tenant. Once they fund the deposit and first month&apos;s rent, the lease starts and rent is paid
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
        <Stat label="Tenant received">
          <Amount value={a.tenantRefund + a.rentToTenant} />
        </Stat>
        <Stat label="Landlord received">
          <Amount value={a.landlordClaim + a.rentToLandlord - a.fee} />
        </Stat>
      </div>
    </Card>
  );
}
