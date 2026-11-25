"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

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
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            data-kind={t.kind}
            className={`pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg ${toastStyle[t.kind]}`}
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="mt-0.5">
                {t.kind === "pending" ? <Spinner /> : toastIcon[t.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 break-words opacity-80">{t.body}</p>}
                {t.href && (
                  <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-block underline">
                    View on BscScan
                  </a>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const toastStyle: Record<ToastKind, string> = {
  pending: "border-sky-200 bg-white text-slate-900 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-100",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50",
  error: "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-50",
  info: "border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
};
const toastIcon: Record<Exclude<ToastKind, "pending">, string> = { success: "✓", error: "!", info: "i" };

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] ${className}`}
    />
  );
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used inside <ToastProvider>");
  return ctx;
}
