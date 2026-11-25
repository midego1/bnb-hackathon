"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Address } from "viem";
import { Spinner } from "@/components/Toasts";
import type { DemoStep, DemoTx } from "@/lib/demo/script";
import { shortAddress } from "@/lib/format";
import { actorLabel, panels } from "./copy";

export type StepStatus = "pending" | "running" | "done" | "error";

/**
 * The right column of the stage: every step of the chosen story (done / current / next) with its transactions.
 * It scrolls inside its own panel and keeps the current step in view; the page itself never moves.
 */
export function StepTimeline({
  steps,
  statuses,
  current,
  txs,
  lease,
  explorer,
}: {
  steps: DemoStep[];
  statuses: StepStatus[];
  current: number;
  txs: Record<string, DemoTx[]>;
  lease?: Address;
  /** Live testnet: each hash opens on the block explorer instead of the lease timeline. */
  explorer?: { tx: (hash: string) => string; title: (hash: string) => string };
}) {
  const list = useRef<HTMLOListElement>(null);
  const txCount = Object.values(txs).reduce((n, t) => n + t.length, 0);

  // Scroll the panel (never the page) so the current step and its latest transaction are visible: when the step or its
  // transactions change, and when the panel itself is resized (e.g. the controls above wrap or the window shrinks).
  useEffect(() => {
    const box = list.current;
    if (!box) return;
    const reveal = () => {
      const item = box.querySelector<HTMLElement>('[data-current="true"]');
      if (!item || box.scrollHeight <= box.clientHeight) return;
      const top = item.offsetTop; // the list is `relative`, so this is relative to it
      const bottom = top + item.offsetHeight;
      if (top < box.scrollTop) box.scrollTop = top - 8;
      else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
    };
    reveal();
    const ro = new ResizeObserver(reveal);
    ro.observe(box);
    return () => ro.disconnect();
  }, [current, txCount]);

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-base font-semibold">{panels.story}</h2>
        {lease && (
          <Link href={`/lease/${lease}`} target="_blank" className="font-mono text-sm underline">
            {shortAddress(lease)}
          </Link>
        )}
      </div>
      <ol ref={list} className="relative space-y-0.5 p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-testid="demo-rail">
        {steps.map((s, i) => {
          const st = statuses[i] ?? "pending";
          const isCurrent = i === current;
          return (
            <li
              key={s.id}
              data-testid="demo-step"
              data-step={s.id}
              data-status={st}
              data-current={isCurrent ? "true" : "false"}
              className={`rounded-xl px-2 py-1.5 transition ${isCurrent ? "bg-warning-soft ring-1 ring-amber-300 dark:ring-amber-800" : ""}`}
            >
              <div className="flex items-start gap-2">
                <StepIcon status={st} n={i + 1} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold leading-snug ${st === "pending" ? "text-subtle" : ""}`}>{s.title}</p>
                  <p className="text-[13px] text-subtle">
                    {actorLabel[s.actor]}
                    {s.demoOnly && (
                      <span className="ml-1 rounded bg-amber-200 px-1 font-medium text-amber-950 dark:bg-amber-400 dark:text-amber-950">{s.demoOnly}</span>
                    )}
                  </p>
                  {(txs[s.id] ?? []).map((t) => (
                    <p key={t.hash} className="flex items-center justify-between gap-1 text-[13px]">
                      <span className="min-w-0 truncate text-muted">{t.label}</span>
                      {explorer ? (
                        <a
                          href={explorer.tx(t.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={explorer.title(t.hash)}
                          className="shrink-0 whitespace-nowrap font-mono underline decoration-dotted"
                          data-testid="demo-tx"
                        >
                          {t.hash.slice(0, 6)}…{t.hash.slice(-4)} ↗
                        </a>
                      ) : (
                        <Link
                          href={lease ? `/lease/${lease}` : "#"}
                          target="_blank"
                          title={panels.txTitle(t.hash)}
                          className="shrink-0 whitespace-nowrap font-mono underline decoration-dotted"
                          data-testid="demo-tx"
                        >
                          {t.hash.slice(0, 6)}…{t.hash.slice(-4)}
                        </Link>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepIcon({ status, n }: { status: StepStatus; n: number }) {
  const base = "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold";
  if (status === "done")
    return (
      <span className={`${base} bg-emerald-500 text-white dark:bg-emerald-600`} aria-label="done">
        ✓
      </span>
    );
  if (status === "error")
    return (
      <span className={`${base} bg-rose-500 text-white dark:bg-rose-600`} aria-label="failed">
        !
      </span>
    );
  if (status === "running")
    return (
      <span className={`${base} bg-amber-400 text-slate-950`} aria-label="running">
        <Spinner />
      </span>
    );
  return <span className={`${base} bg-surface-strong text-muted`}>{n}</span>;
}
