"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

const ConfirmDialogView = dynamic(() => import("./ConfirmDialogView").then((m) => m.ConfirmDialogView), { ssr: false });

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

  // The AlertDialog itself loads on first use (client only): it stays out of the server bundle and the first load.
  const dialog = opts ? <ConfirmDialogView opts={opts} settle={settle} /> : null;

  return { confirm, dialog };
}
