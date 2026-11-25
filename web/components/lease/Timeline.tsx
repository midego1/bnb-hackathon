"use client";

import type { ReactNode } from "react";
import { keccak256, toBytes } from "viem";
import { Card, Skeleton, useMoney } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { formatDate } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { roleOfAddress } from "./model";

const LANDLORD_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.landlord-response"));
const ARBITER_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.arbiter-deadline"));
type Money = (v: bigint) => string;
const months = (n: unknown) => `${n} month${Number(n) === 1 ? "" : "s"}`;
const evidenceKinds = ["check-in photo", "check-out photo", "document"];

function describe(e: TimelineEvent, lease: LeaseData, money: Money): { title: string; body?: ReactNode; tone: string } {
  const a = e.args;
  const usdt = (v: unknown) => money(v as bigint);
  switch (e.name) {
    case "LeaseCreated":
      return { title: "Lease offered by the landlord", body: `${usdt(a.rentAmount)} / month, ${usdt(a.depositAmount)} deposit, ${a.termMonths} months`, tone: "bg-slate-400" };
    case "Funded":
      return { title: "Tenant funded the escrow", body: `${usdt(a.deposit)} deposit + ${usdt(a.firstRent)} first month's rent`, tone: "bg-success" };
    case "RentPaid":
      return { title: `Tenant prepaid ${months(a.months)} of rent`, body: usdt(a.amount), tone: "bg-success" };
    case "RentReleased":
      return {
        title: `${months(a.months)} of rent paid out to the landlord`,
        body: `${usdt(a.toLandlord)} to landlord${(a.fee as bigint) > BigInt(0) ? `, ${usdt(a.fee)} KeyEscrow fee` : ""} · triggered by the ${roleOfAddress(lease, a.caller)}`,
        tone: "bg-success",
      };
    case "EvidenceAdded":
      return {
        title: `${evidenceKinds[Number(a.kind)] ?? "evidence"} recorded by the ${roleOfAddress(lease, a.by)}`,
        body: <code className="text-xs" title={String(a.contentHash)}>{String(a.contentHash).slice(0, 18)}…</code>,
        tone: "bg-slate-400",
      };
    case "SettlementProposed":
      return { title: `The ${roleOfAddress(lease, a.proposer)} proposed a deposit split`, body: `tenant gets ${usdt(a.tenantRefund)} · landlord keeps ${usdt(a.landlordClaim)}`, tone: "bg-info" };
    case "DisputeRaised":
      return { title: `The ${roleOfAddress(lease, a.by)} opened a dispute`, tone: "bg-danger" };
    case "Settled":
      return {
        title: a.basis === LANDLORD_TIMEOUT_BASIS ? "Settled: landlord did not reply in time" : a.basis === ARBITER_TIMEOUT_BASIS ? "Settled: dispute desk deadline passed" : "Settled, all funds paid out",
        body: `tenant ${usdt((a.tenantRefund as bigint) + (a.rentToTenant as bigint))} · landlord ${usdt((a.landlordClaim as bigint) + (a.rentToLandlord as bigint) - (a.fee as bigint))}`,
        tone: "bg-accent",
      };
    case "ProtocolFeePaid":
      return { title: "One-time KeyEscrow fee taken from the landlord's first payout", body: usdt(a.amount), tone: "bg-slate-400" };
    case "Cancelled":
      return { title: "Offer cancelled by the landlord", tone: "bg-zinc-400" };
    default:
      return { title: e.name, tone: "bg-slate-400" };
  }
}

export function Timeline({ lease, events, chainId, unavailable }: { lease: LeaseData; events: TimelineEvent[] | undefined; chainId: number; unavailable?: boolean }) {
  const money = useMoney();
  return (
    <Card title="Timeline">
      {unavailable ? (
        <p className="text-sm text-subtle">History is unavailable because this network&apos;s RPC refused the event query. Balances and actions above are still live.</p>
      ) : !events ? (
        <Skeleton className="h-24" />
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-5" data-testid="timeline">
          {events.map((e) => {
            const d = describe(e, lease, money);
            const href = explorerLink(chainId, "tx", e.txHash);
            return (
              <li key={`${e.txHash}-${e.logIndex}`} className="relative" data-event={e.name}>
                <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${d.tone}`} />
                <p className="text-sm font-medium first-letter:uppercase">{d.title}</p>
                {d.body && <p className="text-sm text-muted">{d.body}</p>}
                <p className="text-xs text-subtle">
                  {formatDate(e.timestamp)} · block {e.blockNumber.toString()}
                  {href && (
                    <>
                      {" · "}
                      <a href={href} target="_blank" rel="noreferrer" className="underline">
                        BscScan
                      </a>
                    </>
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
