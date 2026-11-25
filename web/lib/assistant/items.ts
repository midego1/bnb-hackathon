/** What the panel shows in a conversation (client-safe). Stored as is in the browser's chat history. */
import type { ApprovalCard, Card } from "./cards";
import type { StepKind, StepState } from "./events";

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "step"; id: string; stepKind: StepKind; label: string; state: StepState; detail?: string; cards: Card[] }
  | { kind: "card"; id: string; card: Card }
  | {
      kind: "approval";
      id: string;
      card: ApprovalCard;
      txs: { to: string; data: string; value: string }[];
      state: "waiting" | "signing" | "approved" | "declined" | "expired" | "failed";
      progress?: string;
    }
  | { kind: "navigate"; id: string; path: string; label: string; followed: boolean }
  | { kind: "notice"; id: string; tone: "error" | "info"; text: string }
  | { kind: "applied"; id: string; count: number };
