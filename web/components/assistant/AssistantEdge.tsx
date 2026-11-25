"use client";

import type { AssistantState } from "@/lib/assistant/events";

/**
 * The window-edge light: blue and travelling while Ask AI reads or thinks, amber and faster while a change is signed
 * and confirmed, violet and steady (with the page dimmed a little, still usable) while a change waits for approval.
 * Purely decorative (aria-hidden, no pointer events); colours and timings are the --assistant-* tokens in globals.css.
 */
export function AssistantEdge({ state }: { state: AssistantState }) {
  return (
    <div aria-hidden data-assistant-edge="" data-assistant-state={state} data-testid="assistant-edge">
      <div data-assistant-dim="" />
      <div data-assistant-ring="" />
    </div>
  );
}
