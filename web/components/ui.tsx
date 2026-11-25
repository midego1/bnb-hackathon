"use client";

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LeaseStatus } from "@/lib/contracts";
import { explorerLink } from "@/lib/chains";
import { formatDuration, formatUsdt, shortAddress } from "@/lib/format";
import { formatFiat, toFiat, type PriceResponse } from "@/lib/fiat";
import { usePrices } from "@/lib/usePrices";
import { Spinner } from "./Toasts";

export function Card({ children, className = "", title, aside }: { children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 shadow-sm ${className}`}>
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
      {children && <p className="mt-2 max-w-2xl text-muted">{children}</p>}
    </div>
  );
}

export const statusMeta: Record<LeaseStatus, { label: string; hint: string; className: string }> = {
  [LeaseStatus.Created]: {
    label: "Awaiting funding",
    hint: "The tenant still has to fund the deposit and first month's rent.",
    className: "bg-warning-soft text-warning-fg ring-warning-border",
  },
  [LeaseStatus.Active]: {
    label: "Active",
    hint: "The deposit is locked in escrow; rent is paid out to the landlord month by month.",
    className: "bg-success-soft text-success-fg ring-success-border",
  },
  [LeaseStatus.MoveOut]: {
    label: "Move-out proposal",
    hint: "A deposit split is on the table and waits for the other side to answer.",
    className: "bg-info-soft text-info-fg ring-info-border",
  },
  [LeaseStatus.Disputed]: {
    label: "In dispute",
    hint: "The dispute desk decides how the deposit is split.",
    className: "bg-danger-soft text-danger-fg ring-danger-border",
  },
  [LeaseStatus.Settled]: {
    label: "Settled",
    hint: "All funds have been paid out. This lease is closed.",
    className: "bg-surface-strong text-foreground ring-border-strong",
  },
  [LeaseStatus.Cancelled]: {
    label: "Cancelled",
    hint: "The landlord withdrew this offer before it was funded.",
    className: "bg-surface-muted text-muted ring-border",
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
    primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
    secondary:
      "border border-border-strong bg-surface text-foreground hover:border-border-hover",
    danger: "border border-danger-border bg-surface text-danger hover:bg-danger-soft",
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
      {disabledReason && <p className="text-xs text-subtle">{disabledReason}</p>}
    </div>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint && <span className="text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border-strong bg-field px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

const SOURCE_LABEL: Record<PriceResponse["source"], { text: string; hint: string; className: string }> = {
  mock: {
    text: "Demo rates",
    hint: "Fixed demo exchange rates (no CoinMarketCap key or Atlas feed configured). Not live market data.",
    className: "bg-warning-soft text-warning-fg ring-warning-border",
  },
  cmc: {
    text: "Live CoinMarketCap",
    hint: "USDT and THB rates from the CoinMarketCap Pro API, fetched server-side and cached for about a minute.",
    className: "bg-success-soft text-success-fg ring-success-border",
  },
  atlas: {
    text: "Atlas feed",
    hint: "USDT price from the Atlas on-chain price feed, read server-side and cached for about a minute.",
    className: "bg-info-soft text-info-fg ring-info-border",
  },
};

/** Where the THB / USD figures come from, as reported by GET /api/price. */
export function PriceSourceBadge({ className = "" }: { className?: string }) {
  const { prices } = usePrices();
  if (!prices) return null;
  const m = SOURCE_LABEL[prices.source];
  const updated = new Date(prices.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <span
      data-testid="price-source"
      data-source={prices.source}
      title={`${m.hint}${prices.warning ? ` Note: ${prices.warning}` : ""} Updated ${updated}.`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.className} ${className}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {m.text}
      {prices.warning && " · stale"}
    </span>
  );
}

/** Plain-text money for sentences and timelines: "฿14,559 ($441.18)", or "441.18 USDT" until rates load. */
export function useMoney() {
  const { prices } = usePrices();
  return useCallback(
    (value: bigint) => {
      const thb = toFiat(value, "USDT", "THB", prices);
      const usd = toFiat(value, "USDT", "USD", prices);
      if (thb === null || usd === null) return `${formatUsdt(value)} USDT`;
      return `${formatFiat(thb, "THB")} (${formatFiat(usd, "USD")})`;
    },
    [prices],
  );
}

/**
 * An on-chain USDT amount shown THB first, then USD, with the exact token amount underneath.
 * Falls back to the USDT figure alone until /api/price answers.
 */
export function Amount({ value, className = "", size = "md" }: { value: bigint; className?: string; size?: "md" | "lg" }) {
  const { prices } = usePrices();
  const thb = toFiat(value, "USDT", "THB", prices);
  const usd = toFiat(value, "USDT", "USD", prices);
  const big = size === "lg" ? "text-2xl" : "";
  if (thb === null || usd === null) {
    return (
      <span className={`inline-flex flex-col ${className}`}>
        <span className={`font-semibold tabular-nums ${big}`}>{formatUsdt(value)} USDT</span>
      </span>
    );
  }
  const source = prices ? SOURCE_LABEL[prices.source].text.toLowerCase() : "";
  return (
    <span className={`inline-flex flex-col ${className}`} title={`${formatUsdt(value)} USDT on-chain · converted at ${source}`}>
      <span className={`font-semibold tabular-nums ${big}`} data-testid="amount-thb">
        {formatFiat(thb, "THB")}
      </span>
      <span className="text-xs text-subtle tabular-nums">
        {formatFiat(usd, "USD")} · {formatUsdt(value)} USDT
      </span>
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
      {label && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-muted">{label}</span>}
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

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-subtle hover:text-foreground"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label={label ?? "Copy address"}
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
    info: "border-info-border bg-info-soft text-info-fg",
    warn: "border-warning-border bg-warning-soft text-warning-fg",
    error: "border-danger-border bg-danger-soft text-danger-fg",
  }[kind];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-strong ${className}`} />;
}
