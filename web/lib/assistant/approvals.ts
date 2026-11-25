/**
 * Approvals and conversation state. The server keeps the EXACT prepared steps of a change (by id, short TTL); the
 * browser only answers approve or decline for that id. One change waits per chat at a time. An id that does not match
 * the waiting change is refused (and the waiting one stays); an expired one is gone; a new message, Stop or New chat
 * expires it. An approval can be taken once.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Address, Hex } from "viem";
import type { ApprovalCard } from "./cards";
import type { AssistantStore } from "./store";

export const APPROVAL_TTL_MS = 10 * 60_000;
export const CHAT_TTL_MS = 6 * 3600_000;

export type Approval = {
  id: string;
  chatId: string;
  toolUseId: string;
  action: string;
  title: string;
  chainId: number;
  from: Address;
  steps: { to: Address; data: Hex; value: string; description: string; function: string }[];
  lease?: Address;
  card: ApprovalCard;
  createdAt: number;
  expiresAt: number;
};

export type TakeResult =
  | { ok: true; approval: Approval }
  | { ok: false; reason: "none" | "mismatch" | "expired"; message: string };

const key = (chatId: string) => `approval:${chatId}`;

export async function putApproval(store: AssistantStore, a: Approval): Promise<void> {
  // Kept a little past its expiry so a late answer is told "expired" rather than "unknown".
  await store.set(key(a.chatId), a, a.expiresAt - a.createdAt + 60_000);
}

export async function peekApproval(store: AssistantStore, chatId: string): Promise<Approval | undefined> {
  return store.get<Approval>(key(chatId));
}

/** Take the waiting approval `id` of `chatId` (once). */
export async function takeApproval(store: AssistantStore, chatId: string, id: string, now = Date.now()): Promise<TakeResult> {
  const a = await store.get<Approval>(key(chatId));
  if (!a) return { ok: false, reason: "none", message: "There is no change waiting for approval in this chat." };
  if (a.id !== id) return { ok: false, reason: "mismatch", message: "This approval does not match the change that is waiting." };
  await store.delete(key(chatId));
  if (a.expiresAt <= now) return { ok: false, reason: "expired", message: "This approval expired. Ask again to prepare the change anew." };
  return { ok: true, approval: a };
}

export async function expireApproval(store: AssistantStore, chatId: string): Promise<boolean> {
  const had = (await store.get(key(chatId))) !== undefined;
  await store.delete(key(chatId));
  return had;
}

// ----------------------------------------------------------------------------------------------------------------
// Conversation state
// ----------------------------------------------------------------------------------------------------------------

export type PendingTurn = {
  approvalId: string;
  toolUseId: string;
  /** Results of the other tool calls of the same model turn, in call order; `null` marks the waiting change. */
  results: (Anthropic.ToolResultBlockParam | null)[];
};

export type ChatState = {
  chatId: string;
  messages: Anthropic.MessageParam[];
  pending?: PendingTurn;
  /** Per message (reset on each new message from the person). */
  counters: { steps: number; tools: number };
  updatedAt: number;
};

const chatKey = (chatId: string) => `chat:${chatId}`;

export async function loadChat(store: AssistantStore, chatId: string, now = Date.now()): Promise<ChatState> {
  return (await store.get<ChatState>(chatKey(chatId))) ?? { chatId, messages: [], counters: { steps: 0, tools: 0 }, updatedAt: now };
}

export async function saveChat(store: AssistantStore, chat: ChatState, now = Date.now()): Promise<void> {
  await store.set(chatKey(chat.chatId), { ...chat, updatedAt: now }, CHAT_TTL_MS);
}

/** New chat: drop the conversation and expire what waits in it. */
export async function resetChat(store: AssistantStore, chatId: string): Promise<void> {
  await expireApproval(store, chatId);
  await store.delete(chatKey(chatId));
}

/** The tool results to send for a pending turn, with the waiting change answered by `answer`. */
export function resolvePending(p: PendingTurn, answer: string, isError: boolean): Anthropic.ToolResultBlockParam[] {
  return p.results.map((r) => r ?? { type: "tool_result", tool_use_id: p.toolUseId, content: answer, ...(isError ? { is_error: true } : {}) });
}
