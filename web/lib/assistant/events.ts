/**
 * Ask AI's wire format: one run = one POST /api/assistant, answered with a stream of JSON events in Server-Sent
 * Events framing (`data: {...}\n\n`). Client-safe: no server imports, so the panel parses with the same types.
 */
import type { Card, ApprovalCard } from "./cards";

/** What the assistant is doing; drives the status line and the window-edge light. */
export type AssistantState = "idle" | "reading" | "changing" | "waiting";

export type StepKind = "read" | "change" | "page";
export type StepState = "running" | "done" | "failed" | "waiting" | "declined" | "expired";

export type AssistantEvent =
  | { type: "run_started"; runId: string; chatId: string; model: string; mock: boolean; refusedModel?: string }
  | { type: "status"; state: AssistantState; text: string }
  | { type: "step"; id: string; kind: StepKind; label: string; state: StepState; detail?: string }
  | { type: "card"; stepId?: string; card: Card }
  /** `txs` are the exact unsigned steps the server keeps for this approval; the wallet signs these, in order. */
  | { type: "approval_required"; stepId: string; card: ApprovalCard; txs: { to: string; data: string; value: string }[] }
  | { type: "text_delta"; text: string }
  | { type: "navigate"; path: string; label: string }
  | { type: "run_finished"; reason: "done" | "waiting" | "stopped" | "limit" | "error"; changesApplied?: number }
  | { type: "error"; code: string; message: string };

const encoder = new TextEncoder();

/** One event as an SSE frame. JSON never contains a raw newline, so one `data:` line is always enough. */
export function encodeEvent(event: AssistantEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Incremental SSE parser: feed it chunks as they arrive, it returns the complete events so far and keeps the rest.
 * Ignores comments (`: ping`) and anything that is not a JSON object with a string `type`.
 */
export function createEventParser() {
  const decoder = new TextDecoder();
  let buffer = "";
  return (chunk: Uint8Array | string): AssistantEvent[] => {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const out: AssistantEvent[] = [];
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const e = JSON.parse(data);
        if (e && typeof e === "object" && typeof e.type === "string") out.push(e as AssistantEvent);
      } catch {
        /* a broken frame is dropped, never shown */
      }
    }
    return out;
  };
}

/** A ReadableStream the engine writes events into; closing twice or writing after close is a no-op. */
export function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  return {
    stream,
    emit(event: AssistantEvent) {
      if (closed) return;
      try {
        controller.enqueue(encodeEvent(event));
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed by the reader */
      }
    },
  };
}
