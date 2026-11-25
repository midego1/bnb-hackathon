"use client";

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LeaseStatus } from "@/lib/contracts";
import { explorerLink } from "@/lib/chains";
import { formatUsdt, shortAddress } from "@/lib/format";
import { formatFiat, toFiat, type PriceResponse } from "@/lib/fiat";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/t";
import { usePrices } from "@/lib/usePrices";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card as UiCard, CardHeader } from "./ui/card";
import { Label } from "./ui/label";
import { Skeleton as UiSkeleton } from "./ui/skeleton";
import { Spinner } from "./Toasts";

/** A titled panel (shadcn Card): `title` renders as an h2, `aside` sits at the right of the title row. */
export function Card({ children, className = "", title, aside }: { children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode }) {
  return (
    <UiCard className={cn("block gap-0 overflow-visible rounded-2xl border border-border p-5 text-[length:inherit] shadow-sm ring-0", className)}>
      {(title || aside) && (
        <CardHeader className="mb-4 flex flex-wrap items-center justify-between gap-2 px-0">
          {title && (
            <h2 data-slot="card-title" className="text-base leading-snug font-semibold">
              {title}
            </h2>
          )}
          {aside}
        </CardHeader>
      )}
      {children}
    </UiCard>
  );
}

/** `title` may be a bilingual headline (t.h). */
export function PageTitle({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {children && <p className="mt-2 max-w-2xl text-muted-foreground">{children}</p>}
    </div>
  );
}

/** English label and hint (for code outside React); the badge reads `ui.status.<key>` in the active language. */
export const statusMeta: Record<LeaseStatus, { key: "created" | "active" | "moveOut" | "disputed" | "settled" | "cancelled"; label: string; hint: string; className: string }> = {
  [LeaseStatus.Created]: {
    key: "created",
    label: "Awaiting funding",
    hint: "The renter still has to fund the deposit and first month's rent.",
    className: "bg-warning-soft text-warning-fg ring-warning-border",
  },
  [LeaseStatus.Active]: {
    key: "active",
    label: "Active",
    hint: "The deposit is locked in escrow; rent is paid out to the owner month by month.",
    className: "bg-success-soft text-success-fg ring-success-border",
  },
  [LeaseStatus.MoveOut]: {
    key: "moveOut",
    label: "Return proposal",
    hint: "A deposit split is on the table and waits for the other side to answer.",
    className: "bg-info-soft text-info-fg ring-info-border",
  },
  [LeaseStatus.Disputed]: {
    key: "disputed",
    label: "In dispute",
    hint: "The dispute desk decides how the deposit is split.",
    className: "bg-danger-soft text-danger-fg ring-danger-border",
  },
  [LeaseStatus.Settled]: {
    key: "settled",
    label: "Settled",
    hint: "All funds have been paid out. This rental is closed.",
    className: "bg-surface-strong text-foreground ring-border-strong",
  },
  [LeaseStatus.Cancelled]: {
    key: "cancelled",
    label: "Cancelled",
    hint: "The owner withdrew this offer before it was funded.",
    className: "bg-muted text-muted-foreground ring-border",
  },
};

export function StatusBadge({ status }: { status: LeaseStatus }) {
  const m = statusMeta[status];
  const t = useT();
  return (
    <Badge
      data-testid="status-badge"
      data-status={status}
      title={t(`ui.status.${m.key}.hint`)}
      className={cn("h-auto rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", m.className)}
    >
      {t(`ui.status.${m.key}.label`)}
    </Badge>
  );
}

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** When set, the button is disabled and the reason is shown under it. */
  disabledReason?: string | false | null;
  busy?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

const BUTTON_VARIANT = { primary: "default", secondary: "outline", danger: "outline" } as const;
/** Our size and colours on top of the shadcn Button (same look as before the move to shadcn/ui). */
const ACTION_BUTTON_CLASS = {
  primary: "h-auto min-h-10 gap-2 whitespace-normal px-4 py-2 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45",
  secondary:
    "h-auto min-h-10 gap-2 whitespace-normal border-border-strong bg-surface px-4 py-2 text-foreground hover:border-border-hover hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45 dark:border-border-strong dark:bg-surface dark:hover:bg-surface",
  danger:
    "h-auto min-h-10 gap-2 whitespace-normal border-danger-border bg-surface px-4 py-2 text-danger hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-45 dark:border-danger-border dark:bg-surface dark:hover:bg-danger-soft",
} as const;

export function ActionButton({ disabledReason, busy, variant = "primary", children, className = "", ...rest }: ActionButtonProps) {
  const disabled = !!disabledReason || busy || rest.disabled;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Button {...rest} disabled={disabled} variant={BUTTON_VARIANT[variant]} className={ACTION_BUTTON_CLASS[variant]}>
        {busy && <Spinner />}
        {children}
      </Button>
      {disabledReason && <p className="text-xs text-subtle">{disabledReason}</p>}
    </div>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <Label className="flex flex-col items-stretch gap-1 text-sm leading-normal font-normal select-auto">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint && <span className="text-xs text-subtle">{hint}</span>}
    </Label>
  );
}

/**
 * For native <input>, <select> and <textarea>: the shadcn Input look (components/ui/input.tsx) at our field size.
 * Prefer <Input> / <Textarea> from components/ui for new forms.
 */
export const inputClass =
  "w-full min-w-0 rounded-lg border border-input bg-field px-3 py-2 text-sm transition-colors outline-none placeholder:text-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

/** Text and hint: `ui.source.<source>` in the dictionary. */
const SOURCE_LABEL: Record<PriceResponse["source"], { className: string }> = {
  mock: {
    className: "bg-warning-soft text-warning-fg ring-warning-border",
  },
  cmc: {
    className: "bg-success-soft text-success-fg ring-success-border",
  },
  atlas: {
    className: "bg-info-soft text-info-fg ring-info-border",
  },
};

/** Where the THB / USD figures come from, as reported by GET /api/price. */
export function PriceSourceBadge({ className = "" }: { className?: string }) {
  const { prices } = usePrices();
  const t = useT();
  if (!prices) return null;
  const m = SOURCE_LABEL[prices.source];
  const updated = new Date(prices.updatedAt).toLocaleTimeString(t.lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const hint = t(`ui.source.${prices.source}.hint`) + (prices.warning ? t("ui.source.note", { warning: prices.warning }) : "") + t("ui.source.updated", { time: updated });
  return (
    <Badge
      data-testid="price-source"
      data-source={prices.source}
      title={hint}
      className={cn("h-auto rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", m.className, className)}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(`ui.source.${prices.source}.text`)}
      {prices.warning && t("ui.source.stale")}
    </Badge>
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

/** Baht only, for headlines: "฿6,800", or "206.06 USDT" until rates load. */
export function useBaht() {
  const { prices } = usePrices();
  return useCallback(
    (value: bigint) => {
      const thb = toFiat(value, "USDT", "THB", prices);
      return thb === null ? `${formatUsdt(value)} USDT` : formatFiat(thb, "THB");
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
  const t = useT();
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
  const source = prices ? t(`ui.source.${prices.source}.text`).toLowerCase() : "";
  return (
    <span className={`inline-flex flex-col ${className}`} title={t("ui.source.converted", { usdt: formatUsdt(value), source })}>
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
      {label && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{label}</span>}
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
  const t = useT();
  const text = label ?? t("ui.copyAddress");
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      title={done ? t("ui.copied") : text}
      className="h-auto px-1 py-0.5 text-subtle hover:bg-transparent hover:text-foreground dark:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3.5"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label={text}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}

/** lib/format.ts formatDuration in the active language: "3d 4h", "2h 5m", "7m". */
function duration(seconds: number, t: T) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return t("ui.duration.dh", { d, h });
  if (h > 0) return t("ui.duration.hm", { h, m });
  return t("ui.duration.m", { m: Math.max(m, 1) });
}

/**
 * Live countdown to a chain timestamp, anchored to chain time (`chainNow`, read at wall-clock `fetchedAt`)
 * rather than the browser clock, so it stays right on a time-warped anvil.
 */
export function Countdown({ target, clock, doneText }: { target: bigint; clock: { chainNow: bigint; fetchedAt: number }; doneText?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const t = useT();
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - clock.fetchedAt) / 1000));
  const left = Number(target - clock.chainNow) - elapsed;
  return <span className="tabular-nums">{left <= 0 ? (doneText ?? t("ui.now")) : t("ui.in", { left: duration(left, t) })}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error"; children: ReactNode }) {
  const style = {
    info: "border-info-border bg-info-soft text-info-fg",
    warn: "border-warning-border bg-warning-soft text-warning-fg",
    error: "border-danger-border bg-danger-soft text-danger-fg",
  }[kind];
  // shadcn Alert, kept a block (its grid would split inline text and links) and only announced for errors.
  return (
    <Alert role={kind === "error" ? "alert" : undefined} data-kind={kind} className={cn("block rounded-xl px-4 py-3 text-sm", style)}>
      {children}
    </Alert>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <UiSkeleton className={cn("rounded-lg bg-surface-strong", className)} />;
}
