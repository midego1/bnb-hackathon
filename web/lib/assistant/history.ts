/**
 * Ask AI's chat history, kept in THIS BROWSER only (there is no login): never sent to the server, never shared.
 * One list per connected wallet and chain, newest first, at most 50 chats, each kept 30 days after its last use.
 * Every storage access is wrapped: private mode, a full quota or corrupted data give an empty or shorter list, never
 * an error. Pure functions over a Storage-like object, so they are unit-tested without a browser.
 */
import type { Item } from "./items";

export const HISTORY_MAX_CHATS = 50;
export const HISTORY_TTL_MS = 30 * 24 * 3600_000;
/** After this long without use, the panel opens with a new chat. */
export const CHAT_IDLE_MS = 6 * 3600_000;
export const TITLE_MAX = 80;

export type StoredChat = {
  id: string;
  title: string;
  /** True once the person renamed it (then the first message no longer sets the title). */
  renamed?: boolean;
  createdAt: number;
  updatedAt: number;
  model?: string;
  items: Item[];
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "keyescrow.askai.history.v1";

/** The storage key of one wallet's history on one chain ("none" without a wallet). */
export function historyKey(address: string | undefined | null, chainId: number): string {
  return `${PREFIX}:${chainId}:${address ? address.toLowerCase() : "none"}`;
}

/** First message, on one line, cut at 80 characters. */
export function titleFrom(items: Item[]): string {
  const first = items.find((i): i is Extract<Item, { kind: "user" }> => i.kind === "user")?.text ?? "New chat";
  const line = first.replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

function isChat(x: unknown): x is StoredChat {
  const c = x as StoredChat;
  return !!c && typeof c.id === "string" && typeof c.title === "string" && typeof c.updatedAt === "number" && Array.isArray(c.items);
}

/** The live chats, newest first (expired and malformed entries dropped). */
export function loadHistory(storage: StorageLike | undefined, key: string, now = Date.now()): StoredChat[] {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(isChat)
      .filter((c) => now - c.updatedAt < HISTORY_TTL_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_MAX_CHATS);
  } catch {
    return [];
  }
}

/** Write the list; when the quota is full, drop the oldest chats until it fits. False when nothing could be saved. */
function write(storage: StorageLike | undefined, key: string, list: StoredChat[]): boolean {
  let keep = list.slice(0, HISTORY_MAX_CHATS);
  while (true) {
    try {
      if (keep.length === 0) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(keep));
      return true;
    } catch {
      if (keep.length <= 1) return false;
      keep = keep.slice(0, Math.max(1, Math.floor(keep.length / 2)));
    }
  }
}

/** Add or update a chat (it becomes the newest). A chat with no message is not stored. */
export function upsertChat(storage: StorageLike | undefined, key: string, chat: Omit<StoredChat, "title" | "updatedAt"> & { title?: string }, now = Date.now()): StoredChat[] {
  if (!chat.items.some((i) => i.kind === "user")) return loadHistory(storage, key, now);
  const list = loadHistory(storage, key, now);
  const old = list.find((c) => c.id === chat.id);
  const next: StoredChat = {
    ...chat,
    title: old?.renamed ? old.title : (chat.title ?? titleFrom(chat.items)),
    ...(old?.renamed ? { renamed: true } : {}),
    createdAt: old?.createdAt ?? chat.createdAt,
    updatedAt: now,
  };
  const out = [next, ...list.filter((c) => c.id !== chat.id)];
  write(storage, key, out);
  return out.slice(0, HISTORY_MAX_CHATS);
}

export function renameChat(storage: StorageLike | undefined, key: string, id: string, title: string, now = Date.now()): StoredChat[] {
  const t = title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  const list = loadHistory(storage, key, now);
  if (!t) return list;
  const out = list.map((c) => (c.id === id ? { ...c, title: t, renamed: true } : c));
  write(storage, key, out);
  return out;
}

export function deleteChat(storage: StorageLike | undefined, key: string, id: string, now = Date.now()): StoredChat[] {
  const out = loadHistory(storage, key, now).filter((c) => c.id !== id);
  write(storage, key, out);
  return out;
}

/** Titles containing every word of `q` (case-insensitive). */
export function searchChats(list: StoredChat[], q: string): StoredChat[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => words.every((w) => c.title.toLowerCase().includes(w)));
}

/**
 * A chat as it is shown again (read-only, or continued): a change that waited for approval, or was being signed, can
 * never be applied later, so it shows as "Expired, not done".
 */
export function asReopened(items: Item[]): Item[] {
  return items.map((i) => (i.kind === "approval" && (i.state === "waiting" || i.state === "signing") ? { ...i, state: "expired" as const, progress: undefined } : i));
}

/** The browser's localStorage, or undefined where it is not available (SSR, blocked). */
export function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
