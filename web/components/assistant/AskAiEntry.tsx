"use client";

import { useAssistantPanel } from "./AssistantProvider";

/**
 * The "Ask AI" entry: a row for the app shell's sidebar (or anywhere else). Opens and closes the panel, like Cmd+J /
 * Ctrl+J. Kept as one small component so the shell decides where it goes.
 */
export function AskAiEntry({ className = "" }: { className?: string }) {
  const { open, toggle } = useAssistantPanel();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      data-testid="ask-ai-entry"
      title="Ask AI (Ctrl+J / ⌘J)"
      className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap text-muted transition hover:bg-surface-muted ${open ? "bg-surface-muted text-foreground" : ""} ${className}`}
    >
      <span aria-hidden className="text-[var(--assistant-waiting)]">
        ✦
      </span>
      Ask AI
      <kbd className="ml-auto hidden rounded border border-border px-1 font-sans text-[10px] text-subtle sm:inline">⌘J</kbd>
    </button>
  );
}
