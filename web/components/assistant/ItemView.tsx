"use client";

import Link from "next/link";
import type { Item } from "@/lib/assistant/items";
import { safeAppPath } from "@/lib/assistant/paths";
import { ApprovalCardView, CardView } from "./AssistantCards";
import { Markdown } from "./Markdown";

/** One entry of a conversation: a message, an answer, a step with its cards, an approval, a notice. */
const STEP_ICON: Record<string, string> = { running: "◌", done: "✓", failed: "✕", waiting: "✋", declined: "–", expired: "–" };

export function ItemView({ item, onApprove, onDecline }: { item: Item; onApprove?: (id: string) => void; onDecline?: (id: string) => void }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl bg-surface-muted px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="assistant-user">
            {item.text}
          </p>
        </div>
      );
    case "text":
      return (
        <div data-testid="assistant-answer">
          <Markdown text={item.text} />
        </div>
      );
    case "step":
      return (
        <div className="space-y-2" data-testid="assistant-step" data-kind={item.stepKind} data-state={item.state}>
          <p className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ring-1 ${item.state === "failed" ? "text-danger ring-danger-border" : item.state === "running" ? "ring-[var(--assistant-reading)]" : "text-[var(--assistant-waiting)] ring-border"}`}
              {...(item.state === "running" ? { "data-assistant-pulse": "" } : {})}
            >
              {STEP_ICON[item.state]}
            </span>
            <span className={item.state === "failed" ? "text-danger" : ""}>{item.label}</span>
          </p>
          {item.detail && <p className="pl-7 text-xs text-muted">{item.detail}</p>}
          {item.cards.map((c, i) => (
            <div key={i} className="pl-7">
              <CardView card={c} />
            </div>
          ))}
        </div>
      );
    case "card":
      return <CardView card={item.card} />;
    case "approval":
      return <ApprovalCardView card={item.card} state={item.state} progress={item.progress} onApprove={() => onApprove?.(item.id)} onDecline={() => onDecline?.(item.id)} />;
    case "navigate": {
      const safe = safeAppPath(item.path);
      return (
        <p className="flex items-center gap-2 text-sm" data-testid="assistant-navigate" data-followed={item.followed}>
          <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-[var(--assistant-waiting)] ring-1 ring-border">
            ↗
          </span>
          {item.followed ? `Opened ${item.label}` : "Ready:"}
          {!item.followed && safe && (
            <Link href={safe} className="underline underline-offset-2" data-testid="assistant-go-there">
              go there ({item.label})
            </Link>
          )}
        </p>
      );
    }
    case "notice":
      return (
        <p className={`rounded-lg px-3 py-2 text-sm ${item.tone === "error" ? "bg-danger-soft text-danger-fg" : "text-muted"}`} data-testid="assistant-notice">
          {item.text}
        </p>
      );
    case "applied":
      return (
        <p className="rounded-lg bg-success-soft px-3 py-2 text-sm font-medium text-success-fg" data-testid="assistant-applied">
          {item.count} change{item.count === 1 ? "" : "s"} applied
        </p>
      );
  }
}
