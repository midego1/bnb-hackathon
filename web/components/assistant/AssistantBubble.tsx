"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import type { Ref } from "react";
import { useT } from "@/lib/i18n/client";

/**
 * The Ask AI launcher: a round bubble fixed bottom right (the only entry point besides Cmd+J / Ctrl+J). A dot shows
 * a change waiting for approval (violet) or a reply that arrived while the window was closed. `small` on the
 * one-screen stages (/demo, /how-it-works, /pitch), so it stays clear of their controls. Hidden on phones while the
 * window (a full-height sheet there) is open; the window's own close button takes over.
 */
export function AssistantBubble({
  ref,
  open,
  onToggle,
  dot,
  small,
}: {
  ref: Ref<HTMLButtonElement>;
  open: boolean;
  onToggle: () => void;
  dot: "waiting" | "unread" | null;
  small: boolean;
}) {
  const t = useT();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label={t("ai.name")}
      aria-expanded={open}
      aria-controls="assistant-window"
      title={t("ai.entryTitle")}
      data-testid="assistant-bubble"
      data-dot={dot ?? undefined}
      className={`fixed z-[75] inline-flex items-center justify-center rounded-full border border-border bg-background text-foreground shadow-xl transition hover:scale-105 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:scale-100 ${
        small ? "right-1 bottom-1 size-8" : "right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] size-14"
      } ${open ? "max-sm:hidden" : ""}`}
    >
      {open ? (
        <ChevronDown aria-hidden className={small ? "size-4" : "size-6"} />
      ) : (
        <Sparkles aria-hidden className={`text-(--assistant-waiting) ${small ? "size-4" : "size-6"}`} />
      )}
      {dot && !open && (
        <span
          data-testid="assistant-bubble-dot"
          className={`absolute top-0 right-0 rounded-full ring-2 ring-background ${small ? "size-2.5" : "size-3.5"} ${dot === "waiting" ? "bg-(--assistant-waiting)" : "bg-primary"}`}
        >
          <span className="sr-only">{t(dot === "waiting" ? "ai.waitingApproval" : "ai.unread")}</span>
        </span>
      )}
    </button>
  );
}
