"use client";

import { ArrowUpRight, CircleAlert, CircleCheck, Compass, PenLine, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader, type ToolState } from "@/components/ai-elements/tool";
import type { StepKind, StepState } from "@/lib/assistant/events";
import type { Item } from "@/lib/assistant/items";
import { safeAppPath } from "@/lib/assistant/paths";
import { useT } from "@/lib/i18n/client";
import { ApprovalCardView, CardView } from "./AssistantCards";
import { Markdown } from "./Markdown";

/** A step (a tool call: read, change or page) as an AI Elements Tool: state badge (dictionary ai.step), then its detail and cards. */
const STEP: Record<StepState, ToolState> = {
  running: "input-available",
  done: "output-available",
  failed: "output-error",
  waiting: "approval-requested",
  declined: "output-denied",
  expired: "output-denied",
};
const STEP_ICON: Record<StepKind, LucideIcon> = { read: Search, change: PenLine, page: Compass };

/**
 * A conversation as chat bubbles: the person's messages on the right, and everything Ask AI says or does between two
 * of them (answers, steps with their server cards, approvals, notices) in one assistant bubble on the left.
 */
export function ChatItems({ items, onApprove, onDecline }: { items: Item[]; onApprove?: (id: string) => void; onDecline?: (id: string) => void }) {
  const turns: Item[][] = [];
  for (const item of items) {
    const last = turns.at(-1);
    if (item.kind !== "user" && last && last[0].kind !== "user") last.push(item);
    else turns.push([item]);
  }
  return turns.map((turn) =>
    turn[0].kind === "user" ? (
      <ItemView key={turn[0].id} item={turn[0]} />
    ) : (
      <div key={turn[0].id} className="mr-auto flex w-full max-w-[94%] min-w-0 flex-col gap-2 rounded-2xl rounded-bl-md bg-muted/70 p-2.5" data-testid="assistant-turn">
        {turn.map((item) => (
          <ItemView key={item.id} item={item} onApprove={onApprove} onDecline={onDecline} />
        ))}
      </div>
    ),
  );
}

/** One entry of a conversation: a message, an answer, a step with its cards, an approval, a notice. */
export function ItemView({ item, onApprove, onDecline }: { item: Item; onApprove?: (id: string) => void; onDecline?: (id: string) => void }) {
  const t = useT();
  switch (item.kind) {
    case "user":
      return (
        <Message from="user" className="max-w-[85%]">
          <MessageContent
            className="whitespace-pre-wrap [overflow-wrap:anywhere] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-primary group-[.is-user]:px-3 group-[.is-user]:py-2 group-[.is-user]:text-primary-foreground"
            data-testid="assistant-user"
          >
            {item.text}
          </MessageContent>
        </Message>
      );
    case "text":
      return (
        <Message from="assistant" className="max-w-full">
          <MessageContent className="w-full overflow-visible" data-testid="assistant-answer">
            <Markdown text={item.text} />
          </MessageContent>
        </Message>
      );
    case "step": {
      const hasBody = !!item.detail || item.cards.length > 0;
      return (
        <Tool defaultOpen className="mb-0 rounded-xl border-border bg-surface" data-testid="assistant-step" data-kind={item.stepKind} data-state={item.state}>
          <ToolHeader
            type={`tool-${item.stepKind}`}
            state={STEP[item.state]}
            title={item.label}
            icon={STEP_ICON[item.stepKind]}
            statusLabel={t(`ai.step.${item.state === "running" ? item.stepKind : item.state}`)}
            static={!hasBody}
            className="gap-2 px-3 py-2"
          />
          {hasBody && (
            <ToolContent className="space-y-2 px-3 pt-0 pb-3">
              {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
              {item.cards.map((c, i) => (
                <CardView key={i} card={c} />
              ))}
            </ToolContent>
          )}
        </Tool>
      );
    }
    case "card":
      return <CardView card={item.card} />;
    case "approval":
      return <ApprovalCardView card={item.card} state={item.state} progress={item.progress} onApprove={() => onApprove?.(item.id)} onDecline={() => onDecline?.(item.id)} />;
    case "navigate": {
      const safe = safeAppPath(item.path);
      return (
        <p className="flex items-center gap-2 text-sm" data-testid="assistant-navigate" data-followed={item.followed}>
          <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full text-(--assistant-waiting) ring-1 ring-border">
            <ArrowUpRight className="size-3" />
          </span>
          {item.followed ? t("ai.opened", { label: item.label }) : t("ai.ready")}
          {!item.followed && safe && (
            <Link href={safe} className="underline underline-offset-2" data-testid="assistant-go-there">
              {t("ai.goThere", { label: item.label })}
            </Link>
          )}
        </p>
      );
    }
    case "notice":
      return (
        <p
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${item.tone === "error" ? "bg-danger-soft text-danger-fg" : "text-muted-foreground"}`}
          data-testid="assistant-notice"
        >
          {item.tone === "error" && <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
          {item.text}
        </p>
      );
    case "applied":
      return (
        <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm font-medium text-success-fg" data-testid="assistant-applied">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          {t(item.count === 1 ? "ai.applied.one" : "ai.applied.other", { n: item.count })}
        </p>
      );
  }
}
