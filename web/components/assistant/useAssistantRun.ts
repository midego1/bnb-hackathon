"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";
import { createEventParser, type AssistantEvent, type AssistantState } from "@/lib/assistant/events";
import {
  asReopened,
  browserStorage,
  CHAT_IDLE_MS,
  deleteChat as removeStored,
  historyKey,
  loadHistory,
  renameChat as renameStored,
  upsertChat,
  type StoredChat,
} from "@/lib/assistant/history";
import type { Item } from "@/lib/assistant/items";
import { friendlyError } from "@/lib/errors";

export type { Item };

/** The two models a chat can pick (the server enforces the same list). */
export const MODEL_CHOICES = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", short: "Sonnet 5.5", word: "sonnet" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", short: "Haiku 5.5", word: "haiku" },
] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number]["id"];

export type Run = {
  items: Item[];
  state: AssistantState;
  statusText: string;
  busy: boolean;
  mock: boolean | null;
  /** The chat's model pick (null = the server's default). */
  model: ModelChoice | null;
  defaultModel: ModelChoice;
  chatId: string;
};

let seq = 0;
const nid = () => `i${++seq}`;

function newChatId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Ask AI's client state: the chat, the run in flight, and the approval flow. A run is one streaming POST; Stop aborts
 * it. Approving signs the server's exact steps with the CONNECTED wallet (wagmi), then reports the hashes back.
 */
export function useAssistantRun(opts: { path: string; onNavigate: (path: string, label: string) => boolean }) {
  const config = useConfig();
  const { address, chainId: walletChain } = useAccount();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<AssistantState>("idle");
  const [statusText, setStatusText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState<boolean | null>(null);
  const [model, setModelState] = useState<ModelChoice | null>(null);
  const [defaultModel, setDefaultModel] = useState<ModelChoice>("claude-sonnet-5-5");
  const [chatKey, setChatKey] = useState("");
  const [history, setHistory] = useState<StoredChat[]>([]);
  const chatId = useRef<string>("");
  const chatCreated = useRef(0);
  const lastActivity = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  const pathRef = useRef(opts.path);
  useEffect(() => {
    optsRef.current = opts;
    pathRef.current = opts.path;
  });

  useEffect(() => {
    chatId.current = newChatId();
    chatCreated.current = Date.now();
    queueMicrotask(() => setChatKey(chatId.current));
    let alive = true;
    fetch("/api/assistant")
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        setMock(Boolean(b.mock));
        if (MODEL_CHOICES.some((m) => m.id === b.default)) setDefaultModel(b.default);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const chainId = walletChain ?? config.chains[0].id;

  // ---- History (this browser only, per wallet and chain) ----------------------------------------------------------
  const storeKey = historyKey(address, chainId);
  useEffect(() => {
    queueMicrotask(() => setHistory(loadHistory(browserStorage(), storeKey)));
  }, [storeKey]);
  // Save the open chat after every finished run (never while one is in flight).
  useEffect(() => {
    if (busy || !chatKey || !items.some((i) => i.kind === "user")) return;
    const list = upsertChat(browserStorage(), storeKey, { id: chatKey, items, model: model ?? undefined, createdAt: chatCreated.current || Date.now() });
    queueMicrotask(() => setHistory(list));
  }, [busy, items, chatKey, model, storeKey]);

  const apply = useCallback((e: AssistantEvent) => {
    switch (e.type) {
      case "run_started":
        setMock(e.mock);
        if (e.refusedModel) {
          setItems((xs) => [...xs, { kind: "notice", id: nid(), tone: "info", text: `${e.refusedModel} is not available in Ask AI; Claude Sonnet 5.5 answered.` }]);
        }
        return;
      case "status":
        setState(e.state);
        setStatusText(e.text);
        return;
      case "text_delta":
        setItems((xs) => {
          const last = xs.at(-1);
          if (last?.kind === "text") return [...xs.slice(0, -1), { ...last, text: last.text + e.text }];
          return [...xs, { kind: "text", id: nid(), text: e.text }];
        });
        return;
      case "step":
        setItems((xs) => {
          const i = xs.findIndex((x) => x.kind === "step" && x.id === e.id);
          const step: Item = { kind: "step", id: e.id, stepKind: e.kind, label: e.label, state: e.state, detail: e.detail, cards: i >= 0 ? (xs[i] as Extract<Item, { kind: "step" }>).cards : [] };
          if (i >= 0) return xs.map((x, j) => (j === i ? step : x));
          return [...xs, step];
        });
        return;
      case "card":
        setItems((xs) => {
          const i = e.stepId ? xs.findIndex((x) => x.kind === "step" && x.id === e.stepId) : -1;
          if (i >= 0) return xs.map((x, j) => (j === i && x.kind === "step" ? { ...x, cards: [...x.cards, e.card] } : x));
          return [...xs, { kind: "card", id: nid(), card: e.card }];
        });
        return;
      case "approval_required":
        setItems((xs) => [...xs.filter((x) => !(x.kind === "step" && x.id === e.stepId)), { kind: "approval", id: e.stepId, card: e.card, txs: e.txs, state: "waiting" }]);
        return;
      case "navigate": {
        const followed = optsRef.current.onNavigate(e.path, e.label);
        setItems((xs) => [...xs, { kind: "navigate", id: nid(), path: e.path, label: e.label, followed }]);
        return;
      }
      case "error":
        setItems((xs) => [...xs, { kind: "notice", id: nid(), tone: "error", text: e.message }]);
        return;
      case "run_finished":
        if (e.changesApplied) setItems((xs) => [...xs, { kind: "applied", id: nid(), count: e.changesApplied! }]);
        if (e.reason === "stopped") setItems((xs) => [...xs, { kind: "notice", id: nid(), tone: "info", text: "Stopped." }]);
        if (e.reason !== "waiting") {
          setState("idle");
          setStatusText("");
        }
        return;
    }
  }, []);

  const modelRef = useRef<ModelChoice | null>(null);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const stream = useCallback(
    async (body: Record<string, unknown>, initial: { state: AssistantState; text: string } = { state: "reading", text: "Thinking…" }) => {
      const ctl = new AbortController();
      abort.current = ctl;
      lastActivity.current = Date.now();
      setBusy(true);
      setState(initial.state);
      setStatusText(initial.text);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatId: chatId.current, ...body, ...(modelRef.current ? { model: modelRef.current } : {}), context: { path: pathRef.current, address: address ?? null, chainId } }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          apply({ type: "error", code: "http", message: b.error ?? "Ask AI is not available right now." });
          apply({ type: "run_finished", reason: "error" });
          return;
        }
        const parse = createEventParser();
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const e of parse(value)) apply(e);
        }
      } catch (err) {
        if (ctl.signal.aborted) {
          apply({ type: "run_finished", reason: "stopped" });
        } else {
          apply({ type: "error", code: "network", message: "Lost the connection to Ask AI." });
          apply({ type: "run_finished", reason: "error" });
        }
        void err;
      } finally {
        if (abort.current === ctl) abort.current = null;
        setBusy(false);
      }
    },
    [address, apply, chainId],
  );

  const send = useCallback(
    async (text: string) => {
      if (busy) return;
      // A message instead of an answer: the waiting change expires (the server tells the model it was not made).
      setItems((xs) => [...xs.map((x) => (x.kind === "approval" && x.state === "waiting" ? { ...x, state: "expired" as const } : x)), { kind: "user", id: nid(), text }]);
      await stream({ message: text });
    },
    [busy, stream],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    // Stop while a change waits: it expires on the server too.
    setItems((xs) => {
      if (!xs.some((x) => x.kind === "approval" && x.state === "waiting")) return xs;
      void fetch("/api/assistant/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: chatId.current, approvalOnly: true }) });
      return xs.map((x) => (x.kind === "approval" && x.state === "waiting" ? { ...x, state: "expired" as const } : x));
    });
    setState("idle");
    setStatusText("");
  }, []);

  /** New chat: the open one stays in the history (saved after its last run); what waited in it expires. */
  const newChat = useCallback(() => {
    abort.current?.abort();
    const old = chatId.current;
    chatId.current = newChatId();
    chatCreated.current = Date.now();
    setChatKey(chatId.current);
    void fetch("/api/assistant/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: old, approvalOnly: true }) }).catch(() => {});
    setItems([]);
    setModelState(null);
    setState("idle");
    setStatusText("");
  }, []);

  /** Continue an earlier chat: it becomes the open chat again; nothing that waited in it can be applied. */
  const continueChat = useCallback(
    (id: string) => {
      const c = loadHistory(browserStorage(), storeKey).find((x) => x.id === id);
      if (!c) return;
      abort.current?.abort();
      const old = chatId.current;
      void fetch("/api/assistant/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: old, approvalOnly: true }) }).catch(() => {});
      void fetch("/api/assistant/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: c.id, approvalOnly: true }) }).catch(() => {});
      chatId.current = c.id;
      chatCreated.current = c.createdAt;
      lastActivity.current = Date.now();
      setChatKey(c.id);
      setItems(asReopened(c.items));
      setModelState(MODEL_CHOICES.some((m) => m.id === c.model) ? (c.model as ModelChoice) : null);
      setState("idle");
      setStatusText("");
    },
    [storeKey],
  );

  const renameChat = useCallback((id: string, title: string) => setHistory(renameStored(browserStorage(), storeKey, id, title)), [storeKey]);
  const deleteChat = useCallback(
    (id: string) => {
      setHistory(removeStored(browserStorage(), storeKey, id));
      if (id === chatId.current) newChat();
    },
    [newChat, storeKey],
  );
  const setModel = useCallback((m: ModelChoice | null) => setModelState(m), []);

  /** Opening the panel after 6 hours without use starts a new chat (the earlier one stays in the history). */
  const freshen = useCallback(() => {
    if (!busy && lastActivity.current && Date.now() - lastActivity.current > CHAT_IDLE_MS) newChat();
  }, [busy, newChat]);

  const setApproval = (id: string, patch: Partial<Extract<Item, { kind: "approval" }>>) =>
    setItems((xs) => xs.map((x) => (x.kind === "approval" && x.id === id ? { ...x, ...patch } : x)));

  const decline = useCallback(
    async (id: string) => {
      const item = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.id === id);
      if (!item || item.state !== "waiting") return;
      setApproval(id, { state: "declined" });
      await stream({ resume: { approvalId: item.card.id, decision: "decline" } });
    },
    [items, stream],
  );

  const approve = useCallback(
    async (id: string) => {
      const item = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.id === id);
      if (!item || item.state !== "waiting") return;
      const card = item.card;
      if (!address) {
        setApproval(id, { progress: "Connect your wallet to sign." });
        return;
      }
      if (address.toLowerCase() !== card.signer.toLowerCase()) {
        setApproval(id, { progress: `Switch your wallet to ${card.signer}: this change was prepared for it.` });
        return;
      }
      setApproval(id, { state: "signing", progress: "Confirm in your wallet…" });
      setState("changing");
      setStatusText(`Signing: ${card.title}…`);
      const hashes: Hex[] = [];
      let error: string | undefined;
      try {
        if (walletChain !== card.chainId) await switchChain(config, { chainId: card.chainId as never });
        for (const [i, tx] of item.txs.entries()) {
          setApproval(id, { progress: `Step ${i + 1} of ${item.txs.length}: confirm in your wallet…` });
          const hash = await sendTransaction(config, {
            account: address as Address,
            to: tx.to as Address,
            data: tx.data as Hex,
            value: BigInt(tx.value),
            chainId: card.chainId as never,
          });
          hashes.push(hash);
          setState("changing");
          setStatusText(`Confirming step ${i + 1} of ${item.txs.length}…`);
          setApproval(id, { progress: `Step ${i + 1} of ${item.txs.length}: waiting for the block…` });
          const receipt = await waitForTransactionReceipt(config, { hash, chainId: card.chainId as never });
          if (receipt.status !== "success") throw new Error("The transaction was reverted on-chain.");
        }
      } catch (err) {
        error = friendlyError(err);
      }
      await queryClient.invalidateQueries();
      if (hashes.length === 0) {
        // Nothing was signed (rejected in the wallet): that is a decline.
        setApproval(id, { state: "declined", progress: error });
        await stream({ resume: { approvalId: card.id, decision: "decline" } });
        return;
      }
      setApproval(id, { state: error ? "failed" : "approved", progress: error });
      await stream(
        { resume: { approvalId: card.id, decision: "approve", txHashes: hashes, ...(error ? { error: error.slice(0, 300) } : {}) } },
        { state: "changing", text: "Confirming the change on chain…" },
      );
    },
    [address, config, items, queryClient, stream, walletChain],
  );

  const run: Run = { items, state, statusText, busy, mock, model, defaultModel, chatId: chatKey };
  return { run, send, stop, newChat, approve, decline, history, continueChat, renameChat, deleteChat, setModel, freshen };
}
