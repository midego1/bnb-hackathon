"use client";

import { useId } from "react";
import { useT } from "@/lib/i18n/client";

/** Accessible file input that lists the chosen files. Parent owns the File[] state. */
export function FilePicker({
  label,
  accept,
  multiple,
  files,
  onChange,
  hint,
  testId,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  hint?: string;
  testId?: string;
}) {
  const id = useId();
  const t = useT();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <label
        htmlFor={id}
        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-xs text-subtle transition hover:border-border-hover"
      >
        {files.length === 0 ? (
          <span>{hint ?? t("shell.file.choose")}</span>
        ) : (
          files.map((f) => (
            <span key={f.name + f.size} className="max-w-full truncate text-foreground">
              {f.name} · {(f.size / 1024).toFixed(0)} KB
            </span>
          ))
        )}
      </label>
      <input
        id={id}
        data-testid={testId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
      />
    </div>
  );
}
