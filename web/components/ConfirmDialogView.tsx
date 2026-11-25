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
import { useT } from "@/lib/i18n/client";
import type { ConfirmOptions } from "./ConfirmDialog";

/** The dialog of useConfirm() (components/ConfirmDialog.tsx), loaded on first use. */
export function ConfirmDialogView({ opts, settle }: { opts: ConfirmOptions; settle: (ok: boolean) => void }) {
  const t = useT();
  return (
    <AlertDialog open onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description && <AlertDialogDescription className="whitespace-pre-line">{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">{t("shell.confirm.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-ok"
            variant={opts.destructive ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              settle(true);
            }}
          >
            {opts.confirmLabel ?? t("shell.confirm.ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
