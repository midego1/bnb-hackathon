"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { toast as sonner } from "sonner";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Spinner, type Toast, type ToastKind } from "./Toasts";
import { Toaster } from "./ui/sonner";

/**
 * Renders the ToastProvider's toasts with sonner (client only, loaded on demand). The provider decides which toasts
 * exist and when they go; this mirrors that list into sonner, which only draws and animates them.
 */
export function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const shown = useRef(new Map<number, Toast>());
  useEffect(() => {
    const ids = new Set(toasts.map((t) => t.id));
    for (const id of shown.current.keys()) {
      if (!ids.has(id)) {
        sonner.dismiss(id);
        shown.current.delete(id);
      }
    }
    for (const t of toasts) {
      if (shown.current.get(t.id) === t) continue;
      shown.current.set(t.id, t);
      sonner.custom(() => <ToastView toast={t} onDismiss={() => onDismiss(t.id)} />, { id: t.id, duration: Infinity, dismissible: false });
    }
  }, [toasts, onDismiss]);
  return <Toaster position="bottom-right" expand visibleToasts={8} gap={8} style={{ "--width": "384px" } as React.CSSProperties} />;
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
  const tr = useT();
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
              {tr("shell.toast.explorer")}
            </a>
          )}
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100" aria-label={tr("shell.toast.dismiss")}>
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

