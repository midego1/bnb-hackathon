"use client";

import { ArrowRight, ArrowUpRight, ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle, type ToolState } from "@/components/ai-elements/confirmation";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ApprovalCard as Approval, Card, DoneCard as Done, LeaseCard as Lease, LeaseListCard as LeaseList, Money } from "@/lib/assistant/cards";
import { safeAppPath } from "@/lib/assistant/paths";

/** Cards are server data rendered as plain text; every link is an in-app path checked again here (or BscScan). */

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const STATUS_TONE: Record<string, string> = {
  Created: "bg-warning-soft text-warning-fg ring-warning-border",
  Active: "bg-success-soft text-success-fg ring-success-border",
  MoveOut: "bg-info-soft text-info-fg ring-info-border",
  Disputed: "bg-danger-soft text-danger-fg ring-danger-border",
  Settled: "bg-muted text-muted-foreground ring-border-strong",
  Cancelled: "bg-muted text-subtle ring-border",
};

function Status({ status, label }: { status: string; label: string }) {
  return (
    <Badge variant="outline" className={`h-auto rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ring-1 ${STATUS_TONE[status] ?? ""}`}>
      {label}
    </Badge>
  );
}

function Amount({ m, strong }: { m: Money; strong?: boolean }) {
  return (
    <span className="inline-flex flex-col">
      <span className={strong ? "font-semibold" : "font-medium"}>{m.thb ?? m.token}</span>
      {m.thb && (
        <span className="text-[11px] text-subtle">
          {m.usd} · {m.token}
        </span>
      )}
    </span>
  );
}

function InApp({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  const safe = safeAppPath(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <Link href={safe} className={className}>
      {children}
    </Link>
  );
}

const shell = "rounded-xl border border-border bg-surface p-3 text-sm shadow-xs";

export function CardView({ card }: { card: Card }) {
  switch (card.kind) {
    case "lease":
      return <LeaseCardView c={card} />;
    case "lease_list":
      return <LeaseListView c={card} />;
    case "done":
      return <DoneView c={card} />;
    case "approval":
      return null;
  }
}

function LeaseCardView({ c }: { c: Lease }) {
  return (
    <div className={shell} data-testid="assistant-card-lease" data-status={c.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <InApp href={`/lease/${c.address}`} className="font-mono text-xs text-subtle hover:underline">
            Rental {short(c.address)}
          </InApp>
          <p className="mt-0.5 font-medium">{c.headline}</p>
        </div>
        <Status status={c.status} label={c.statusLabel} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[11px] text-subtle">Deposit</dt>
          <dd>
            <Amount m={c.deposit} strong />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-subtle">Rent / month</dt>
          <dd>
            <Amount m={c.rent} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-subtle">In escrow now</dt>
          <dd>
            <Amount m={c.escrow} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Owner {short(c.owner)} · Renter {short(c.renter)}
        {c.you ? ` · You: ${c.you}` : ""} · {c.months.funded}/{c.months.term} month(s) paid
      </p>
      {c.next && (
        <p className="mt-2 rounded-lg bg-muted px-2 py-1.5 text-xs" data-testid="assistant-card-next">
          <span className="font-medium">Next · {c.next.who}:</span> {c.next.what}
        </p>
      )}
      <div className="mt-2 flex gap-3 text-xs">
        {c.links.map((l) =>
          l.external ? (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
              {l.label}
              <ArrowUpRight aria-hidden className="size-3" />
            </a>
          ) : (
            <InApp key={l.href} href={l.href} className="underline underline-offset-2">
              {l.label}
            </InApp>
          ),
        )}
      </div>
    </div>
  );
}

function LeaseListView({ c }: { c: LeaseList }) {
  const [all, setAll] = useState(false);
  const rows = all ? c.rows : c.rows.slice(0, 5);
  const byStatus = Object.entries(c.totals.byStatus);
  return (
    <div className={shell} data-testid="assistant-card-list" data-total={c.totals.all}>
      <p className="font-medium">
        {c.totals.all} rental{c.totals.all === 1 ? "" : "s"} · {c.totals.open} open
      </p>
      {byStatus.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {byStatus.map(([s, n]) => `${n} ${s === "MoveOut" ? "return proposal" : s === "Created" ? "awaiting funding" : s.toLowerCase()}`).join(" · ")}
          {` · deposits locked ${c.totals.deposits.thb ?? c.totals.deposits.token}`}
        </p>
      )}
      <ul className="mt-2 divide-y divide-border">
        {rows.map((r) => (
          <li key={`${r.address}-${r.role}`} className="flex items-center justify-between gap-2 py-1.5">
            <InApp href={r.href} className="min-w-0 truncate font-mono text-xs hover:underline">
              {short(r.address)} <span className="font-sans text-subtle">as {r.role}</span>
            </InApp>
            <span className="flex shrink-0 items-center gap-2 text-xs">
              {r.deposit.thb ?? r.deposit.token}
              <Status status={r.status} label={r.statusLabel} />
            </span>
          </li>
        ))}
      </ul>
      {c.rows.length > 5 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${c.rows.length}`}
        </button>
      )}
      {c.truncated && <p className="mt-1 text-[11px] text-subtle">Only the newest 50 per role are listed.</p>}
    </div>
  );
}

function DoneView({ c }: { c: Done }) {
  return (
    <div className="rounded-xl border border-success-border bg-success-soft p-3 text-sm text-success-fg" data-testid="assistant-card-done">
      <p className="flex items-center gap-1.5 font-medium">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {c.title}: {c.applied} transaction{c.applied === 1 ? "" : "s"} confirmed
      </p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {c.txs.map((t) => (
          <li key={t.hash} className="flex flex-wrap gap-x-2">
            <span>{t.description}</span>
            {t.href ? (
              <a href={t.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono underline underline-offset-2">
                {short(t.hash)}
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            ) : (
              <span className="font-mono" title={t.hash}>
                {short(t.hash)} (local chain)
              </span>
            )}
          </li>
        ))}
      </ul>
      {c.lease && (
        <InApp href={c.lease.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">
          Open rental {short(c.lease.address)}
          <ArrowRight aria-hidden className="size-3" />
        </InApp>
      )}
    </div>
  );
}

type ApprovalState = "waiting" | "signing" | "approved" | "declined" | "expired" | "failed";

/** Our approval states on the AI Elements Confirmation states (approval requested / responded / output ...). */
const CONFIRMATION: Record<ApprovalState, { state: ToolState; approved?: boolean }> = {
  waiting: { state: "approval-requested" },
  signing: { state: "approval-responded", approved: true },
  approved: { state: "output-available", approved: true },
  declined: { state: "output-denied", approved: false },
  expired: { state: "output-denied", approved: false },
  failed: { state: "output-error", approved: true },
};

const OUTCOME: Record<Exclude<ApprovalState, "waiting">, string> = {
  signing: "Signing…",
  approved: "Approved and signed",
  declined: "Declined, not done",
  expired: "Expired, not done",
  failed: "Not completed",
};

/**
 * The approval card: the AI Elements Confirmation shell around the server-built card (title, the changes with before
 * and after, signer, transactions). Approve hands the transactions to the connected wallet (useAssistantRun).
 */
export function ApprovalCardView({
  card,
  state,
  progress,
  onApprove,
  onDecline,
}: {
  card: Approval;
  state: ApprovalState;
  progress?: string;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const waiting = state === "waiting";
  const tone = waiting || state === "signing" ? "border-(--assistant-waiting) ring-1 ring-(--assistant-waiting)" : "border-border";
  const c = CONFIRMATION[state];
  return (
    <Confirmation
      state={c.state}
      approval={c.approved === undefined ? { id: card.action } : { id: card.action, approved: c.approved }}
      role="group"
      aria-label={card.title}
      className={`block gap-0 rounded-xl border-2 bg-surface p-0 text-sm text-foreground ${tone}`}
      data-testid="assistant-approval"
      data-state={state}
      data-action={card.action}
    >
      <div className="border-b border-border px-3 py-2">
        <ConfirmationTitle className="block font-semibold text-foreground">{card.title}</ConfirmationTitle>
        <p className="flex items-center gap-1 text-xs text-warning">
          <TriangleAlert aria-hidden className="size-3 shrink-0" />
          This changes the rental on chain. Check it before you approve.
        </p>
      </div>
      <div className="space-y-2 p-3">
        <ul className="space-y-1 rounded-lg bg-muted p-2 text-xs" data-testid="assistant-approval-changes">
          {card.changes.map((ch, i) => (
            <li key={i} className="grid grid-cols-[7.5rem_1fr] gap-2">
              <span className="text-subtle">{ch.label}</span>
              <span className="min-w-0 break-words">
                {ch.before && (
                  <>
                    <s className="text-subtle">{ch.before}</s> →{" "}
                  </>
                )}
                <span className="font-medium">{ch.after}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Signed by: <span className="font-medium">{card.signerRole}</span> <span className="font-mono">{short(card.signer)}</span> (your wallet) ·{" "}
          {card.steps.length} transaction{card.steps.length === 1 ? "" : "s"}
          {card.ratesMock ? " · demo rates" : ""}
        </p>
        <Collapsible>
          <CollapsibleTrigger className="group/details inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground">
            <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[state=open]/details:rotate-90" />
            Details
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 space-y-1 text-xs text-muted-foreground">
            <p>{card.summary}</p>
            <ol className="list-decimal pl-5">
              {card.steps.map((s, i) => (
                <li key={i}>
                  {s.description} · <span className="font-mono">{s.function}</span> on <span className="font-mono">{short(s.to)}</span>
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
        {progress && (
          <p className="text-xs text-muted-foreground" data-testid="assistant-approval-progress">
            {progress}
          </p>
        )}
        <ConfirmationRequest>
          <ConfirmationActions className="justify-start self-start pt-1">
            <ConfirmationAction
              onClick={onApprove}
              data-testid="assistant-approve"
              className="h-8 bg-(--assistant-waiting) px-3 text-sm text-(--assistant-waiting-foreground) hover:bg-(--assistant-waiting) hover:opacity-90"
            >
              Approve
            </ConfirmationAction>
            <ConfirmationAction variant="ghost" onClick={onDecline} data-testid="assistant-decline" className="h-8 px-3 text-sm">
              Decline
            </ConfirmationAction>
          </ConfirmationActions>
        </ConfirmationRequest>
        {!waiting && (
          <p className="text-xs font-medium" data-testid="assistant-approval-outcome">
            {OUTCOME[state]}
          </p>
        )}
      </div>
    </Confirmation>
  );
}
