"use client";

import type { ReactNode } from "react";
import { keccak256, toBytes } from "viem";
import { Card, Skeleton } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { formatDate, formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { roleOfAddress } from "./model";

const LANDLORD_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.landlord-response"));
const ARBITER_TIMEOUT_BASIS = keccak256(toBytes("keyescrow.timeout.arbiter-deadline"));
const usdt = (v: unknown) => `${formatUsdt(v as bigint)} USDT`;
const evidenceKinds = ["check-in photo", "check-out photo", "document"];

function describe(e: TimelineEvent, lease: LeaseData): { title: string; body?: ReactNode; tone: string } {
  const a = e.args;
  switch (e.name) {
    case "LeaseCreated":
      return { title: "Lease offered by the landlord", body: `${usdt(a.rentAmount)} / month, ${usdt(a.depositAmount)} deposit, ${a.termMonths} months`, tone: "bg-slate-400" };
    case "Funded":
      return { title: "Tenant funded the escrow", body: `${usdt(a.deposit)} deposit + ${usdt(a.firstRent)} first rent`, tone: "bg-emerald-500" };
    case "RentPaid":
      return { title: `Tenant prepaid ${a.months} month(s)`, body: usdt(a.amount), tone: "bg-emerald-500" };
    case "RentReleased":
      return {
        title: `${a.months} month(s) of rent released`,
        body: `${usdt(a.toLandlord)} to landlord${(a.fee as bigint) > BigInt(0) ? `, ${usdt(a.fee)} protocol fee` : ""} · by ${roleOfAddress(lease, a.caller)}`,
        tone: "bg-emerald-500",
      };
    case "EvidenceAdded":
      return { title: `${evidenceKinds[Number(a.kind)] ?? "evidence"} anchored by the ${roleOfAddress(lease, a.by)}`, body: <code className="text-xs">{String(a.contentHash).slice(0, 18)}…</code>, tone: "bg-slate-400" };
    case "SettlementProposed":
      return { title: `The ${roleOfAddress(lease, a.proposer)} proposed a deposit split`, body: `tenant ${usdt(a.tenantRefund)} · landlord ${usdt(a.landlordClaim)}`, tone: "bg-sky-500" };
    case "DisputeRaised":
      return { title: `The ${roleOfAddress(lease, a.by)} opened a dispute`, tone: "bg-rose-500" };
    case "Settled":
      return {
        title: a.basis === LANDLORD_TIMEOUT_BASIS ? "Settled: landlord did not respond in time" : a.basis === ARBITER_TIMEOUT_BASIS ? "Settled: arbiter deadline passed" : "Settled",
        body: `tenant ${usdt((a.tenantRefund as bigint) + (a.rentToTenant as bigint))} · landlord ${usdt((a.landlordClaim as bigint) + (a.rentToLandlord as bigint) - (a.fee as bigint))}`,
        tone: "bg-slate-900 dark:bg-white",
      };
    case "ProtocolFeePaid":
      return { title: "One-time KeyEscrow fee paid from the landlord's first rent", body: usdt(a.amount), tone: "bg-slate-400" };
    case "Cancelled":
      return { title: "Offer cancelled by the landlord", tone: "bg-zinc-400" };
    default:
      return { title: e.name, tone: "bg-slate-400" };
  }
}

export function Timeline({ lease, events, chainId, unavailable }: { lease: LeaseData; events: TimelineEvent[] | undefined; chainId: number; unavailable?: boolean }) {
  return (
    <Card title="Timeline">
      {unavailable ? (
        <p className="text-sm text-slate-500">History is unavailable: this RPC refused the event query. Balances and actions above are live.</p>
      ) : !events ? (
        <Skeleton className="h-24" />
      ) : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-5 dark:border-slate-800" data-testid="timeline">
          {events.map((e) => {
            const d = describe(e, lease);
            const href = explorerLink(chainId, "tx", e.txHash);
            return (
              <li key={`${e.txHash}-${e.logIndex}`} className="relative" data-event={e.name}>
                <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-slate-900 ${d.tone}`} />
                <p className="text-sm font-medium first-letter:uppercase">{d.title}</p>
                {d.body && <p className="text-sm text-slate-600 dark:text-slate-400">{d.body}</p>}
                <p className="text-xs text-slate-500">
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
