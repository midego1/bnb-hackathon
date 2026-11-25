"use client";

import { TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { explorerLink } from "@/lib/chains";
import { fetchFleet } from "@/lib/fleet";
import { formatDate, shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/t";
import type { FlagLevel, RentalFlag } from "@/lib/rentals";
import { CopyButton } from "@/components/ui";

/** A transaction hash: links to the block explorer on testnet; on local anvil, short hash + copy. */
export function TxLink({ hash, chainId }: { hash: Hex; chainId: number }) {
  const t = useT();
  const href = explorerLink(chainId, "tx", hash);
  const text = <span className="font-mono text-xs">{shortAddress(hash)}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2" data-testid="tx-link" title={hash}>
      {text}
    </a>
  ) : (
    <span className="inline-flex items-center gap-1" data-testid="tx-link" title={hash}>
      {text}
      <CopyButton value={hash} label={t("roles.copyTx")} />
    </span>
  );
}

const flagStyle: Record<FlagLevel, string> = {
  danger: "bg-danger-soft text-danger-fg ring-danger-border",
  warn: "bg-warning-soft text-warning-fg ring-warning-border",
  info: "bg-info-soft text-info-fg ring-info-border",
};

/** A flag's sentence in the active language, from its code and numbers (lib/rentals.ts flagsFor). */
function flagText({ code, text, vars = {} }: RentalFlag, t: T) {
  const n = vars.n ?? 0;
  const plural = (k: "roles.flag.failedTx" | "roles.flag.rentDue") => t(`${k}.${n === 1 ? "one" : "other"}`, { n });
  const secs = vars.secs ?? 0;
  const d = Math.floor(secs / 86_400);
  const left = d >= 1 ? t(`roles.flag.days.${d === 1 ? "one" : "other"}`, { n: d }) : t("roles.flag.hours", { n: Math.max(1, Math.round(secs / 3600)) });
  switch (code) {
    case "failed-tx":
      return plural("roles.flag.failedTx");
    case "rent-due":
      return plural("roles.flag.rentDue");
    case "arbiter-overdue":
      return t("roles.flag.arbiterOverdue");
    case "disputed":
      return t("roles.flag.disputed", { left });
    case "owner-silent":
      return t("roles.flag.ownerSilent");
    case "proposal-open":
      return t(vars.byRenter ? "roles.flag.proposalOwner" : "roles.flag.proposalRenter");
    case "unfunded":
      return t("roles.flag.unfunded", { left });
    case "overdue-return":
      return t("roles.flag.overdueReturn");
    default:
      return text;
  }
}

export function FlagBadge({ flag }: { flag: RentalFlag }) {
  const t = useT();
  return (
    <span
      data-testid="flag"
      data-level={flag.level}
      data-code={flag.code}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${flagStyle[flag.level]}`}
    >
      {flag.level === "danger" && <TriangleAlert aria-hidden className="mr-1 size-3" />}
      {flagText(flag, t)}
    </span>
  );
}

export function Kpi({ label, children, hint, testId }: { label: string; children: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3" data-testid={testId}>
      <p className="text-xs text-subtle">{label}</p>
      <div className="mt-1 text-lg font-semibold tabular-nums">{children}</div>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export function When({ ts }: { ts: bigint }) {
  const t = useT();
  if (ts === BigInt(0)) return <span className="text-subtle">{t("roles.earlier")}</span>;
  return <span className="tabular-nums">{formatDate(ts, t.lang)}</span>;
}

/** Scooter catalogue + bookings for the active chain (/api/fleet), polled like the chain data. */
export function useFleet() {
  const { chainId } = useDeployment();
  return useQuery({ queryKey: ["fleet", chainId], queryFn: () => fetchFleet(chainId), refetchInterval: 8_000 });
}
