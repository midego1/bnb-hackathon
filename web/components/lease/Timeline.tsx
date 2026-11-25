"use client";

import type { ReactNode } from "react";
import { Check, ExternalLink } from "lucide-react";
import { Card, Skeleton, useMoney } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { formatDate, shortAddress } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { periodCount, periodName } from "@/lib/rentals";
import { rentalCopy as c } from "./copy";
import { roleOfAddress } from "./model";
import { ARBITER_TIMEOUT_BASIS, LANDLORD_TIMEOUT_BASIS } from "./story";
type Money = (v: bigint) => string;
const evidenceKinds = ["pickup photo", "return photo", "document"];

function describe(e: TimelineEvent, lease: LeaseData, money: Money): { title: string; body?: ReactNode; tone: string } {
  const a = e.args;
  const usdt = (v: unknown) => money(v as bigint);
  const per = periodName(lease.terms.rentPeriod);
  const periods = (n: unknown) => periodCount(Number(n), lease.terms.rentPeriod);
  switch (e.name) {
    case "LeaseCreated":
      return { title: "Rental offered by the owner", body: `${usdt(a.rentAmount)} / ${per}, ${usdt(a.depositAmount)} deposit, ${periods(a.termPeriods)}`, tone: "text-subtle" };
    case "Funded":
      return { title: "Renter funded the escrow", body: `${usdt(a.deposit)} deposit + ${usdt(a.firstRent)} rent for the first ${per}`, tone: "text-success" };
    case "RentPaid":
      return { title: `Renter prepaid ${periods(a.periods)} of rent`, body: usdt(a.amount), tone: "text-success" };
    case "RentReleased":
      return {
        title: `${periods(a.periods)} of rent paid out to the owner`,
        body: `${usdt(a.toLandlord)} to owner${(a.fee as bigint) > BigInt(0) ? `, ${usdt(a.fee)} KeyEscrow fee` : ""} · triggered by the ${roleOfAddress(lease, a.caller)}`,
        tone: "text-success",
      };
    case "EvidenceAdded":
      return {
        title: `${evidenceKinds[Number(a.kind)] ?? "evidence"} recorded by the ${roleOfAddress(lease, a.by)}`,
        body: <code className="text-xs" title={String(a.contentHash)}>{String(a.contentHash).slice(0, 18)}…</code>,
        tone: "text-subtle",
      };
    case "SettlementProposed":
      return { title: `The ${roleOfAddress(lease, a.proposer)} proposed a deposit split`, body: `renter gets ${usdt(a.tenantRefund)} · owner keeps ${usdt(a.landlordClaim)}`, tone: "text-info" };
    case "DisputeRaised":
      return { title: `The ${roleOfAddress(lease, a.by)} opened a dispute`, tone: "text-danger" };
    case "Settled":
      return {
        title: a.basis === LANDLORD_TIMEOUT_BASIS ? "Settled: owner did not reply in time" : a.basis === ARBITER_TIMEOUT_BASIS ? "Settled: dispute desk deadline passed" : "Settled, all funds paid out",
        body: `renter ${usdt((a.tenantRefund as bigint) + (a.rentToTenant as bigint))} · owner ${usdt((a.landlordClaim as bigint) + (a.rentToLandlord as bigint) - (a.fee as bigint))}`,
        tone: "text-foreground",
      };
    case "ProtocolFeePaid":
      return { title: "One-time KeyEscrow fee taken from the owner's first payout", body: usdt(a.amount), tone: "text-subtle" };
    case "PayeeSet":
      return { title: c.timeline.payee, tone: "text-subtle" };
    case "Cancelled":
      return { title: "Offer cancelled by the owner", tone: "text-subtle" };
    default:
      return { title: e.name, tone: "text-subtle" };
  }
}

export function Timeline({ lease, events, chainId, unavailable }: { lease: LeaseData; events: TimelineEvent[] | undefined; chainId: number; unavailable?: boolean }) {
  const money = useMoney();
  return (
    <Card title={c.timeline.title} aside={<span className="text-xs text-subtle">{c.timeline.sub}</span>}>
      {unavailable ? (
        <p className="text-sm text-subtle">History is unavailable because this network&apos;s RPC refused the event query. Balances and actions above are still live.</p>
      ) : !events ? (
        <Skeleton className="h-24" />
      ) : events.length === 0 ? (
        <p className="text-sm text-subtle">{c.timeline.none}</p>
      ) : (
        <ol className="divide-y divide-border" data-testid="timeline">
          {events.map((e) => {
            const d = describe(e, lease, money);
            const href = explorerLink(chainId, "tx", e.txHash);
            return (
              <li key={`${e.txHash}-${e.logIndex}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 py-2.5" data-event={e.name}>
                <span className={`mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-muted ${d.tone}`} aria-hidden>
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold first-letter:uppercase">{d.title}</p>
                  {d.body && <p className="text-sm text-muted-foreground">{d.body}</p>}
                </div>
                <p className="text-right text-xs text-subtle tabular-nums">
                  {formatDate(e.timestamp)}
                  <br />
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono underline underline-offset-2">
                      {shortAddress(e.txHash)} <ExternalLink aria-hidden className="size-3" />
                    </a>
                  ) : (
                    <span className="font-mono" title={e.txHash}>
                      {shortAddress(e.txHash)}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
