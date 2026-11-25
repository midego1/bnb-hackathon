"use client";

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
import type { ConfirmOptions } from "./ConfirmDialog";

/** The dialog of useConfirm() (components/ConfirmDialog.tsx), loaded on first use. */
export function ConfirmDialogView({ opts, settle }: { opts: ConfirmOptions; settle: (ok: boolean) => void }) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description && <AlertDialogDescription className="whitespace-pre-line">{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-ok"
            variant={opts.destructive ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              settle(true);
            }}
          >
            {opts.confirmLabel ?? "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
