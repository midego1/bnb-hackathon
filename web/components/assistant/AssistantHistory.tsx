"use client";

import { useState } from "react";
import { asReopened, searchChats, type StoredChat } from "@/lib/assistant/history";
import { ItemView } from "./ItemView";

const when = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Earlier chats in this browser for the connected wallet: search, open, rename, delete (with a confirmation). */
export function HistoryView({
  chats,
  openId,
  onOpen,
  onRename,
  onDelete,
}: {
  chats: StoredChat[];
  openId: string;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = searchChats(chats, q);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="assistant-history-view">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search chats"
        aria-label="Search chats"
        data-testid="assistant-history-search"
        className="mb-3 w-full rounded-lg border border-border-strong bg-field px-3 py-1.5 text-sm outline-none focus:border-border-hover"
      />
      {list.length === 0 ? (
        <p className="pt-6 text-center text-sm text-muted-foreground">{chats.length ? "No chat matches." : "No earlier chats in this browser yet."}</p>
      ) : (
        <ul className="space-y-1" data-testid="assistant-history-list">
          {list.map((c) => (
            <li key={c.id} className="group rounded-lg hover:bg-muted" data-testid="assistant-history-item" data-chat-id={c.id}>
              {editing === c.id ? (
                <form
                  className="flex gap-1 p-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(c.id, title);
                    setEditing(null);
                  }}
                >
                  <input
                    autoFocus
                    value={title}
                    maxLength={80}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    aria-label="Chat title"
                    data-testid="assistant-history-title-input"
                    className="min-w-0 flex-1 rounded border border-border-strong bg-field px-2 py-1 text-sm outline-none"
                  />
                  <button type="submit" className="rounded px-2 text-sm font-medium hover:bg-surface-strong">
                    Save
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left" data-testid="assistant-history-open">
                    <span className="block truncate text-sm">{c.title}</span>
                    <span className="block text-[11px] text-subtle">
                      {when(c.updatedAt)}
                      {c.id === openId ? " · open now" : ""}
                    </span>
                  </button>
                  {confirm === c.id ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs">
                      <button type="button" onClick={() => (onDelete(c.id), setConfirm(null))} className="rounded bg-danger-soft px-2 py-1 font-medium text-danger-fg" data-testid="assistant-history-confirm-delete">
                        Delete
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className="rounded px-2 py-1 hover:bg-surface-strong">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-0.5 opacity-70 group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={`Rename "${c.title}"`}
                        title="Rename"
                        onClick={() => (setEditing(c.id), setTitle(c.title))}
                        className="h-7 w-7 rounded text-sm hover:bg-surface-strong"
                        data-testid="assistant-history-rename"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete "${c.title}"`}
                        title="Delete"
                        onClick={() => setConfirm(c.id)}
                        className="h-7 w-7 rounded text-sm hover:bg-surface-strong"
                        data-testid="assistant-history-delete"
                      >
                        🗑
                      </button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-center text-[11px] text-subtle">Kept in this browser only (50 chats, 30 days), per wallet. Never sent to the server.</p>
    </div>
  );
}

/** An earlier chat, read-only: its steps and cards as they were; what waited for approval shows as expired. */
export function ReadOnlyChat({ chat, onBack, onContinue }: { chat: StoredChat; onBack: () => void; onContinue: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm" data-testid="assistant-readonly">
        <button type="button" onClick={onBack} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted" aria-label="Back to the history">
          ←
        </button>
        <span className="min-w-0 flex-1 truncate font-medium">{chat.title}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {asReopened(chat.items).map((item) => (
          <ItemView key={item.id} item={item} />
        ))}
      </div>
      <div className="border-t border-border p-3">
        <button type="button" onClick={onContinue} data-testid="assistant-continue" className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          Continue this chat
        </button>
        <p className="mt-1.5 text-center text-[11px] text-subtle">Read-only. Changes that waited for approval here have expired.</p>
      </div>
    </>
  );
}
