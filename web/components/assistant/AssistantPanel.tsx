"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type Ref } from "react";
import { interpret, matchCommands, suggestionsFor, type Suggestion } from "@/lib/assistant/composer";
import { safeAppPath } from "@/lib/assistant/paths";
import { ApprovalCardView, CardView } from "./AssistantCards";
import { MIN_WIDTH } from "./constants";
import { Markdown } from "./Markdown";
import type { Item, useAssistantRun } from "./useAssistantRun";

type Assistant = ReturnType<typeof useAssistantRun>;

/**
 * The Ask AI panel: header (follow along, new chat, widen, close), status line, the conversation (steps, server cards,
 * approval cards, answers), suggestions for the page in view, and the composer with slash commands and Stop.
 */
export function AssistantPanel({
  ref,
  assistant,
  path,
  follow,
  onFollow,
  wide,
  onWidth,
  onWide,
  onClose,
}: {
  ref: Ref<HTMLElement>;
  assistant: Assistant;
  path: string;
  follow: boolean;
  onFollow: (v: boolean) => void;
  wide: boolean;
  onWidth: (w: number) => void;
  onWide: () => void;
  onClose: () => void;
}) {
  const { run, send, stop, newChat, approve, decline } = assistant;
  // The one-screen /demo stage keeps its full width: there the panel floats bottom right instead of taking a column.
  const floating = path === "/demo";
  const [draft, setDraft] = useState("");
  const [cmdIndex, setCmdIndex] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const waiting = run.items.some((x) => x.kind === "approval" && (x.state === "waiting" || x.state === "signing"));
  const commands = matchCommands(draft);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.items, run.statusText]);

  const submit = (text: string) => {
    const what = interpret(text);
    if (what.kind === "none" || run.busy) return;
    setDraft("");
    if (what.kind === "new") newChat();
    else void send(what.prompt);
  };

  const pick = (s: Suggestion) => {
    if (s.fill) {
      setDraft(s.prompt);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(s.prompt.length, s.prompt.length);
      });
    } else submit(s.prompt);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => onWidth(Math.min(Math.max(window.innerWidth - ev.clientX, MIN_WIDTH), Math.min(900, window.innerWidth * 0.7)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      ref={ref}
      aria-label="Ask AI"
      data-testid="assistant-panel"
      data-assistant-state={run.state}
            data-floating={floating || undefined}
      className={`fixed inset-x-0 bottom-0 z-[65] flex h-[78dvh] flex-col rounded-t-2xl border border-border bg-background text-foreground shadow-2xl md:inset-x-auto ${
        floating
          ? "md:right-4 md:bottom-4 md:h-[min(58dvh,560px)] md:w-[min(var(--assistant-width),420px)] md:rounded-2xl"
          : "md:top-0 md:right-0 md:h-auto md:w-[var(--assistant-width)] md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none"
      }`}
    >
      {!floating && <div onPointerDown={startResize} className="absolute inset-y-0 left-0 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border-strong md:block" aria-hidden />}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span aria-hidden className="text-[var(--assistant-waiting)]">
          ✦
        </span>
        <h2 className="text-sm font-semibold">Ask AI</h2>
        {run.mock && (
          <span data-testid="assistant-mock-badge" title="No Anthropic key on this server: a scripted demo model answers." className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
            Demo model
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton label={follow ? "Follow along is on: the page goes to what Ask AI changes or opens" : "Follow along is off"} pressed={follow} onClick={() => onFollow(!follow)} testId="assistant-follow">
            {follow ? "👁" : "◌"}
          </IconButton>
          <IconButton label="New chat" onClick={() => newChat()} testId="assistant-new">
            ✎
          </IconButton>
          <IconButton label={wide ? "Narrow the panel" : "Widen to half the window"} onClick={onWide} testId="assistant-widen" className="hidden md:inline-flex">
            {wide ? "⇥" : "⇤"}
          </IconButton>
          <IconButton label="Close (Ctrl+J)" onClick={onClose} testId="assistant-close">
            ✕
          </IconButton>
        </span>
      </header>
      {run.state !== "idle" && (
        <div data-testid="assistant-status" data-state={run.state} className={run.state === "waiting" ? "bg-[var(--assistant-waiting-soft)]" : ""}>
          <div data-assistant-bar="" />
          <p className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium" role="status">
            <span aria-hidden style={{ color: "var(--assistant-tone)" }} {...(run.state === "waiting" ? {} : { "data-assistant-pulse": "" })}>
              {run.state === "waiting" ? "✋" : run.state === "changing" ? "⚡" : "●"}
            </span>
            {run.statusText || (run.state === "waiting" ? "Waiting for your approval" : "Working…")}
          </p>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" data-testid="assistant-log">
        {run.items.length === 0 ? (
          <div className="space-y-3 pt-6">
            <p className="text-center text-sm text-muted">Ask about your rentals, or tell Ask AI what to do. Every change waits for your approval.</p>
            <div className="flex flex-col gap-2" data-testid="assistant-suggestions">
              {suggestionsFor(path).map((s) => (
                <button key={s.label} type="button" onClick={() => pick(s)} className="rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm hover:border-border-hover">
                  {s.label}
                  {s.fill ? "…" : ""}
                </button>
              ))}
            </div>
          </div>
        ) : (
          run.items.map((item) => <ItemView key={item.id} item={item} onApprove={approve} onDecline={decline} />)
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        {commands.length > 0 && (
          <ul className="mb-2 overflow-hidden rounded-lg border border-border bg-surface text-sm" role="listbox" data-testid="assistant-commands">
            {commands.map((c, i) => (
              <li key={c.name} role="option" aria-selected={i === cmdIndex}>
                <button type="button" title={c.prompt ?? c.description} onClick={() => submit(c.name)} className={`flex w-full gap-2 px-3 py-1.5 text-left ${i === cmdIndex ? "bg-surface-muted" : ""}`}>
                  <span className="font-mono">{c.name}</span>
                  <span className="text-muted">{c.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-field px-2 py-1.5 focus-within:border-border-hover">
          <textarea
            ref={input}
            value={draft}
            rows={1}
            maxLength={2000}
            data-testid="assistant-input"
            aria-label="Message Ask AI"
            placeholder={waiting ? "Approve or decline the change first" : "Ask, or tell Ask AI what to do… ( / for commands)"}
            onChange={(e) => {
              setDraft(e.target.value);
              setCmdIndex(0);
            }}
            onKeyDown={(e) => {
              if (commands.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setCmdIndex((i) => (i + (e.key === "ArrowDown" ? 1 : commands.length - 1)) % commands.length);
              } else if (commands.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && draft.trim() !== commands[cmdIndex].name))) {
                e.preventDefault();
                setDraft(commands[cmdIndex].name);
              } else if (e.key === "Escape" && commands.length) {
                setDraft("");
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            className="max-h-32 min-h-[1.75rem] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-subtle"
          />
          {run.busy || run.state === "waiting" ? (
            <button type="button" onClick={stop} data-testid="assistant-stop" className="rounded-lg bg-surface-strong px-2.5 py-1 text-sm font-medium" aria-label="Stop">
              ■ Stop
            </button>
          ) : (
            <button type="submit" data-testid="assistant-send" disabled={!draft.trim()} className="rounded-lg bg-accent px-2.5 py-1 text-sm font-medium text-accent-foreground disabled:opacity-40" aria-label="Send">
              ↑
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-subtle">Changes wait for your approval and your wallet&apos;s signature. Answers can be wrong.</p>
      </form>
    </aside>
  );
}

function IconButton({ label, onClick, children, pressed, testId, className = "" }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; testId: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-sm text-muted hover:bg-surface-muted hover:text-foreground ${className}`}
    >
      {children}
    </button>
  );
}

const STEP_ICON: Record<string, string> = { running: "◌", done: "✓", failed: "✕", waiting: "✋", declined: "–", expired: "–" };

function ItemView({ item, onApprove, onDecline }: { item: Item; onApprove: (id: string) => void; onDecline: (id: string) => void }) {
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
      return <ApprovalCardView card={item.card} state={item.state} progress={item.progress} onApprove={() => onApprove(item.id)} onDecline={() => onDecline(item.id)} />;
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
