"use client";

import { CircleAlert, CircleCheck, Info, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { toast as sonner } from "sonner";
import { cn } from "@/lib/utils";
import { Toaster } from "./ui/sonner";

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
 * Transaction toasts, rendered by sonner (components/ui/sonner.tsx) with our own content: each toast is a
 * role="status" box with data-kind, so tests and screen readers see the same thing as before.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  // The toasts on screen, oldest first (sonner keeps the DOM; this keeps what we need to trim and update them).
  const live = useRef(new Map<number, Toast>());
  const mode = useRef(DEFAULTS);

  const dismiss = useCallback((id: number) => {
    live.current.delete(id);
    sonner.dismiss(id);
  }, []);

  const show = useCallback(
    (t: Toast) => {
      live.current.set(t.id, t);
      const settles = t.kind === "success" || t.kind === "info";
      sonner.custom(() => <ToastView toast={t} onDismiss={() => dismiss(t.id)} />, {
        id: t.id,
        duration: settles ? mode.current.successMs : Infinity,
        onAutoClose: () => live.current.delete(t.id),
        onDismiss: () => live.current.delete(t.id),
      });
    },
    [dismiss],
  );

  const trim = useCallback(() => {
    const ids = [...live.current.keys()];
    for (const id of ids.slice(0, Math.max(0, ids.length - mode.current.max))) dismiss(id);
  }, [dismiss]);

  const clearSettled = useCallback(() => {
    for (const [id, t] of live.current) if (t.kind !== "error") dismiss(id);
  }, [dismiss]);

  const setCompact = useCallback(
    (opts?: { max: number; successMs: number }) => {
      mode.current = opts ?? DEFAULTS;
      trim();
    },
    [trim],
  );

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId++;
      if (mode.current.max <= 0) return id;
      show({ ...t, id });
      trim();
      return id;
    },
    [show, trim],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      const t = live.current.get(id);
      if (t) show({ ...t, ...patch });
    },
    [show],
  );

  const value = useMemo(() => ({ push, update, dismiss, clearSettled, setCompact }), [push, update, dismiss, clearSettled, setCompact]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster position="bottom-right" visibleToasts={DEFAULTS.max} gap={8} style={{ "--width": "384px" } as React.CSSProperties} />
    </ToastContext.Provider>
  );
}

const toastStyle: Record<ToastKind, string> = {
  pending: "border-info-border bg-surface text-foreground",
  success: "border-success-border bg-success-soft text-success-fg",
  error: "border-danger-border bg-danger-soft text-danger-fg",
  info: "border-border bg-surface text-foreground",
};
const toastIcon: Record<ToastKind, ReactNode> = {
  pending: <Spinner />,
  success: <CircleCheck className="size-4" />,
  error: <CircleAlert className="size-4" />,
  info: <Info className="size-4" />,
};

function ToastView({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div role="status" data-kind={t.kind} className={cn("w-(--width) max-w-full rounded-xl border px-4 py-3 text-sm shadow-lg", toastStyle[t.kind])}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 shrink-0">
          {toastIcon[t.kind]}
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
        <button type="button" onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
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
