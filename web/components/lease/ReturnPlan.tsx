"use client";

import { ArrowRight, Check, Minus, X } from "lucide-react";
import { Card } from "@/components/ui";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { cn } from "@/lib/utils";
import { useRentalCopy } from "./copy";
import { returnPlan, type ReturnStep } from "./story";

const DOT: Record<ReturnStep["state"], string> = {
  done: "bg-success-soft text-success-fg",
  warn: "bg-warning-soft text-warning-fg",
  next: "bg-primary text-primary-foreground",
  skip: "bg-muted text-subtle",
  todo: "bg-muted text-muted-foreground",
};
const ICON = { done: Check, warn: X, next: ArrowRight, skip: Minus } as const;

/** The return steps with their deadlines (reply window, dispute desk), from the escrow's terms and events. */
export function ReturnPlan({ lease, events }: { lease: LeaseData; events: TimelineEvent[] | undefined }) {
  const c = useRentalCopy();
  const plan = returnPlan(lease, events, c);
  return (
    <Card title={c.ret.title} aside={<span className="text-xs text-subtle">{plan.sub}</span>}>
      <ol className="divide-y divide-border" data-testid="return-plan">
        {plan.steps.map((s, i) => {
          const Icon = s.state === "todo" ? null : ICON[s.state];
          return (
            <li key={s.title} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 py-2.5" data-state={s.state}>
              <span className={cn("mt-0.5 inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", DOT[s.state])} aria-hidden>
                {Icon ? <Icon className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", s.state === "skip" && "text-subtle line-through")}>{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.sub}</p>
              </div>
              <span className={cn("h-fit rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", s.state === "next" ? "bg-primary text-primary-foreground" : s.state === "warn" ? "bg-warning-soft text-warning-fg" : "bg-muted text-muted-foreground")}>
                {s.when}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
