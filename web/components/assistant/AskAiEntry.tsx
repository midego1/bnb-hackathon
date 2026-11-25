"use client";

import { Icon } from "@/components/shell/icons";
import { useAssistantPanel } from "./AssistantProvider";

/**
 * The "Ask AI" row of the sidebar (expanded, icon rail and the phone drawer). Opens and closes the panel, like
 * Cmd+J / Ctrl+J. `onOpen` lets the drawer close itself when the panel opens.
 */
export function AskAiEntry({ onOpen }: { onOpen?: () => void }) {
  const { open, toggle } = useAssistantPanel();
  return (
    <button
      type="button"
      onClick={() => {
        if (!open) onOpen?.();
        toggle();
      }}
      aria-pressed={open}
      data-testid="ask-ai-entry"
      title="Ask AI (Ctrl+J / ⌘J)"
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-ring rail:justify-center rail:px-0 ${
        open ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      }`}
    >
      <span className="text-[var(--assistant-waiting)]">
        <Icon name="ask" />
      </span>
      <span className="truncate rail:sr-only">Ask AI</span>
      <kbd className="ml-auto rounded border border-border px-1 font-sans text-[10px] font-normal text-subtle rail:hidden max-lg:hidden">⌘J</kbd>
    </button>
  );
}
