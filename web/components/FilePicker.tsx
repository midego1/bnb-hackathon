"use client";

import { useId } from "react";

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
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <label
        htmlFor={id}
        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 transition hover:border-slate-500 dark:border-slate-700"
      >
        {files.length === 0 ? (
          <span>{hint ?? "Tap to choose a file"}</span>
        ) : (
          files.map((f) => (
            <span key={f.name + f.size} className="max-w-full truncate text-slate-800 dark:text-slate-200">
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
