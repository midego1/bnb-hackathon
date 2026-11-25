"use client";

import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search chats"
        aria-label="Search chats"
        data-testid="assistant-history-search"
        className="mb-3 h-8 border-border-strong bg-field text-sm placeholder:text-subtle dark:bg-field"
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
                  <Input
                    autoFocus
                    value={title}
                    maxLength={80}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    aria-label="Chat title"
                    data-testid="assistant-history-title-input"
                    className="h-8 min-w-0 flex-1 border-border-strong bg-field text-sm dark:bg-field"
                  />
                  <Button type="submit" variant="ghost" size="sm" className="h-8 hover:bg-surface-strong">
                    Save
                  </Button>
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
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        onClick={() => (onDelete(c.id), setConfirm(null))}
                        className="bg-danger-soft text-danger-fg hover:bg-danger-soft hover:opacity-90 dark:bg-danger-soft dark:hover:bg-danger-soft"
                        data-testid="assistant-history-confirm-delete"
                      >
                        Delete
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setConfirm(null)} className="hover:bg-surface-strong">
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-0.5 opacity-70 group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Rename "${c.title}"`}
                        title="Rename"
                        onClick={() => (setEditing(c.id), setTitle(c.title))}
                        className="text-muted-foreground hover:bg-surface-strong hover:text-foreground"
                        data-testid="assistant-history-rename"
                      >
                        <Pencil aria-hidden className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete "${c.title}"`}
                        title="Delete"
                        onClick={() => setConfirm(c.id)}
                        className="text-muted-foreground hover:bg-surface-strong hover:text-danger"
                        data-testid="assistant-history-delete"
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                      </Button>
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
        <Button type="button" variant="ghost" size="icon-xs" onClick={onBack} className="text-muted-foreground" aria-label="Back to the history">
          <ArrowLeft aria-hidden />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{chat.title}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {asReopened(chat.items).map((item) => (
          <ItemView key={item.id} item={item} />
        ))}
      </div>
      <div className="border-t border-border p-3">
        <Button type="button" onClick={onContinue} data-testid="assistant-continue" className="h-9 w-full hover:bg-primary-hover">
          Continue this chat
        </Button>
        <p className="mt-1.5 text-center text-[11px] text-subtle">Read-only. Changes that waited for approval here have expired.</p>
      </div>
    </>
  );
}
