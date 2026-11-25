"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const ToastHost = dynamic(() => import("./ToastHost").then((m) => m.ToastHost), { ssr: false });

export type ToastKind = "pending" | "success" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; title: string; body?: string; href?: string };

type Ctx = {
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
  /** Remove every toast except errors (e.g. when a result screen should be unobstructed). */
  clearSettled: () => void;
  /**
   * Compact mode for fast, scripted flows such as the guided demo: at most `max` toasts on screen and success
   * toasts gone after `successMs`; `max: 0` shows none at all (the page reports progress itself). Call with no
   * argument to restore the defaults.
   */
  setCompact: (opts?: { max: number; successMs: number }) => void;
};

const DEFAULTS = { max: 4, successMs: 6000 };

const ToastContext = createContext<Ctx | null>(null);

let nextId = 1;

/**
 * Transaction toasts. The state, limits and timers live here; components/ToastHost.tsx renders them with sonner
 * (components/ui/sonner.tsx). The host loads on the client only, so sonner stays out of the server bundle. Each toast
 * is a role="status" box with data-kind, for tests and screen readers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mode = useRef(DEFAULTS);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const clearSettled = useCallback(() => setToasts((ts) => ts.filter((t) => t.kind === "error")), []);
  const setCompact = useCallback((opts?: { max: number; successMs: number }) => {
    mode.current = opts ?? DEFAULTS;
    setToasts((ts) => (mode.current.max > 0 ? ts.slice(-mode.current.max) : []));
  }, []);
  const autoDismiss = useCallback(
    (id: number, kind: ToastKind) => {
      if (kind === "success" || kind === "info") setTimeout(() => dismiss(id), mode.current.successMs);
    },
    [dismiss],
  );
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId++;
      if (mode.current.max <= 0) return id;
      setToasts((ts) => [...ts.slice(-(mode.current.max - 1)), { ...t, id }]);
      autoDismiss(id, t.kind);
      return id;
    },
    [autoDismiss],
  );
  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.kind) autoDismiss(id, patch.kind);
    },
    [autoDismiss],
  );

  const value = useMemo(() => ({ push, update, dismiss, clearSettled, setCompact }), [push, update, dismiss, clearSettled, setCompact]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Inline busy indicator (buttons, pending toasts): sized like the text around it. */
export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("inline-block size-4 animate-spin align-[-2px]", className)} />;
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used inside <ToastProvider>");
  return ctx;
}
