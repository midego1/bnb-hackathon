"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  /** Label of the confirm button (default "Continue"). */
  confirmLabel?: string;
  /** Red confirm button, for removing or restarting things. */
  destructive?: boolean;
};

/**
 * An in-app replacement for window.confirm (shadcn AlertDialog). `confirm(opts)` resolves true on the confirm button,
 * false on Cancel / Escape; render `dialog` once in the component.
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: "Clear CMC_API_KEY?" }))) return;
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = (
    <AlertDialog open={!!opts} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description && <AlertDialogDescription className="whitespace-pre-line">{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-ok"
            variant={opts?.destructive ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              settle(true);
            }}
          >
            {opts?.confirmLabel ?? "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
