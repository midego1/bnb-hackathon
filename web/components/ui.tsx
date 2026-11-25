"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LeaseStatus } from "@/lib/contracts";
import { explorerLink } from "@/lib/chains";
import { formatDuration, formatUsdt, shortAddress } from "@/lib/format";
import { usePrices } from "@/lib/usePrices";
import { Spinner } from "./Toasts";

export function Card({ children, className = "", title, aside }: { children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {children && <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">{children}</p>}
    </div>
  );
}

export const statusMeta: Record<LeaseStatus, { label: string; hint: string; className: string }> = {
  [LeaseStatus.Created]: {
    label: "Awaiting funding",
    hint: "The tenant still has to fund the deposit and first month's rent.",
    className: "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  },
  [LeaseStatus.Active]: {
    label: "Active",
    hint: "Deposit is locked in escrow; rent is released month by month.",
    className: "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
  },
  [LeaseStatus.MoveOut]: {
    label: "Move-out proposal",
    hint: "A deposit split is on the table and waits for the other party.",
    className: "bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900",
  },
  [LeaseStatus.Disputed]: {
    label: "In dispute",
    hint: "The arbiter decides how the deposit is split.",
    className: "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900",
  },
  [LeaseStatus.Settled]: {
    label: "Settled",
    hint: "All funds have been paid out. This lease is closed.",
    className: "bg-slate-200 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  },
  [LeaseStatus.Cancelled]: {
    label: "Cancelled",
    hint: "The landlord withdrew this offer before it was funded.",
    className: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800",
  },
};

export function StatusBadge({ status }: { status: LeaseStatus }) {
  const m = statusMeta[status];
  return (
    <span
      data-testid="status-badge"
      data-status={status}
      title={m.hint}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${m.className}`}
    >
      {m.label}
    </span>
  );
}

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** When set, the button is disabled and the reason is shown under it. */
  disabledReason?: string | false | null;
  busy?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

export function ActionButton({ disabledReason, busy, variant = "primary", children, className = "", ...rest }: ActionButtonProps) {
  const disabled = !!disabledReason || busy || rest.disabled;
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200",
    secondary:
      "border border-slate-300 bg-white text-slate-900 hover:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
    danger: "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300",
  }[variant];
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <button
        {...rest}
        disabled={disabled}
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
      >
        {busy && <Spinner />}
        {children}
      </button>
      {disabledReason && <p className="text-xs text-slate-500 dark:text-slate-400">{disabledReason}</p>}
    </div>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-600">{error}</span> : hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-950 dark:focus:border-slate-300";

/** USDT amount with THB and USD equivalents (rates from /api/price). */
export function Amount({ value, className = "", size = "md" }: { value: bigint; className?: string; size?: "md" | "lg" }) {
  const { format, isMock } = usePrices();
  const fiat = format(value, "USDT");
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className={`font-semibold tabular-nums ${size === "lg" ? "text-xl" : ""}`}>{formatUsdt(value)} USDT</span>
      {fiat && (
        <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400" title={isMock ? "Demo rates, not live market data" : "Live rate"}>
          ≈ {fiat}
          {isMock && " (demo rates)"}
        </span>
      )}
    </span>
  );
}

export function AddressTag({ address, chainId, label }: { address: string; chainId: number; label?: string }) {
  const href = explorerLink(chainId, "address", address);
  const text = (
    <span className="font-mono text-sm" title={address}>
      {shortAddress(address)}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{label}</span>}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
          {text}
        </a>
      ) : (
        text
      )}
      <CopyButton value={address} />
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label="Copy address"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/**
 * Live countdown to a chain timestamp, anchored to chain time (`chainNow`, read at wall-clock `fetchedAt`)
 * rather than the browser clock, so it stays right on a time-warped anvil.
 */
export function Countdown({ target, clock, doneText = "now" }: { target: bigint; clock: { chainNow: bigint; fetchedAt: number }; doneText?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - clock.fetchedAt) / 1000));
  const left = Number(target - clock.chainNow) - elapsed;
  return <span className="tabular-nums">{left <= 0 ? doneText : `in ${formatDuration(left)}`}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error"; children: ReactNode }) {
  const style = {
    info: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
    warn: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    error: "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100",
  }[kind];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 ${className}`} />;
}
