"use client";

import type { ReactNode } from "react";
import { Check, ExternalLink } from "lucide-react";
import { Card, Skeleton, useMoney } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { shortAddress } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/t";
import { countIn, perIn } from "@/lib/rentals";
import { dateTimeIn, useRentalCopy } from "./copy";
import { roleOfAddress } from "./model";
import { ARBITER_TIMEOUT_BASIS, LANDLORD_TIMEOUT_BASIS } from "./story";
type Money = (v: bigint) => string;
const EVIDENCE_KINDS = ["pickup", "return", "document"] as const;

function describe(e: TimelineEvent, lease: LeaseData, money: Money, t: T): { title: string; body?: ReactNode; tone: string } {
  const a = e.args;
  const usdt = (v: unknown) => money(v as bigint);
  const per = perIn(t, lease.terms.rentPeriod);
  const months = (n: unknown) => countIn(t, Number(n), lease.terms.rentPeriod);
  const role = (who: unknown) => roleOfAddress(lease, who, t);
  switch (e.name) {
    case "LeaseCreated":
      return { title: t("rental.timeline.created"), body: t("rental.timeline.createdBody", { rent: usdt(a.rentAmount), deposit: usdt(a.depositAmount), months: months(a.termPeriods), per }), tone: "text-subtle" };
    case "Funded":
      return { title: t("rental.timeline.funded"), body: t("rental.timeline.fundedBody", { deposit: usdt(a.deposit), rent: usdt(a.firstRent), per }), tone: "text-success" };
    case "RentPaid":
      return { title: t("rental.timeline.rentPaid", { months: months(a.periods) }), body: usdt(a.amount), tone: "text-success" };
    case "RentReleased":
      return {
        title: t("rental.timeline.rentReleased", { months: months(a.periods) }),
        body:
          (a.fee as bigint) > BigInt(0)
            ? t("rental.timeline.releasedBodyFee", { amount: usdt(a.toLandlord), fee: usdt(a.fee), role: role(a.caller) })
            : t("rental.timeline.releasedBody", { amount: usdt(a.toLandlord), role: role(a.caller) }),
        tone: "text-success",
      };
    case "EvidenceAdded":
      return {
        title: t(`rental.timeline.evidence.${EVIDENCE_KINDS[Number(a.kind)] ?? "other"}`, { role: role(a.by) }),
        body: <code className="text-xs" title={String(a.contentHash)}>{String(a.contentHash).slice(0, 18)}…</code>,
        tone: "text-subtle",
      };
    case "SettlementProposed":
      return { title: t("rental.timeline.proposed", { role: role(a.proposer) }), body: t("rental.timeline.proposedBody", { back: usdt(a.tenantRefund), kept: usdt(a.landlordClaim) }), tone: "text-info" };
    case "DisputeRaised":
      return { title: t("rental.timeline.disputed", { role: role(a.by) }), tone: "text-danger" };
    case "Settled":
      return {
        title: t(a.basis === LANDLORD_TIMEOUT_BASIS ? "rental.timeline.settledOwnerLate" : a.basis === ARBITER_TIMEOUT_BASIS ? "rental.timeline.settledDeskLate" : "rental.timeline.settled"),
        body: t("rental.timeline.settledBody", {
          renter: usdt((a.tenantRefund as bigint) + (a.rentToTenant as bigint)),
          owner: usdt((a.landlordClaim as bigint) + (a.rentToLandlord as bigint) - (a.fee as bigint)),
        }),
        tone: "text-foreground",
      };
    case "ProtocolFeePaid":
      return { title: t("rental.timeline.fee"), body: usdt(a.amount), tone: "text-subtle" };
    case "PayeeSet":
      return { title: t("rental.timeline.payee"), tone: "text-subtle" };
    case "Cancelled":
      return { title: t("rental.timeline.cancelled"), tone: "text-subtle" };
    default:
      return { title: e.name, tone: "text-subtle" };
  }
}

export function Timeline({ lease, events, chainId, unavailable }: { lease: LeaseData; events: TimelineEvent[] | undefined; chainId: number; unavailable?: boolean }) {
  const money = useMoney();
  const c = useRentalCopy();
  const t = useT();
  const date = dateTimeIn(t);
  return (
    <Card title={c.timeline.title} aside={<span className="text-xs text-subtle">{c.timeline.sub}</span>}>
      {unavailable ? (
        <p className="text-sm text-subtle">{t("rental.timeline.unavailable")}</p>
      ) : !events ? (
        <Skeleton className="h-24" />
      ) : events.length === 0 ? (
        <p className="text-sm text-subtle">{c.timeline.none}</p>
      ) : (
        <ol className="divide-y divide-border" data-testid="timeline">
          {events.map((e) => {
            const d = describe(e, lease, money, t);
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
                  {date(e.timestamp)}
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
