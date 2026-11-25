"use client";

import { TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { explorerLink } from "@/lib/chains";
import { fetchFleet } from "@/lib/fleet";
import { formatDate, shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import type { FlagLevel, RentalFlag } from "@/lib/rentals";
import { CopyButton } from "@/components/ui";

/** A transaction hash: links to the block explorer on testnet; on local anvil, short hash + copy. */
export function TxLink({ hash, chainId }: { hash: Hex; chainId: number }) {
  const href = explorerLink(chainId, "tx", hash);
  const text = <span className="font-mono text-xs">{shortAddress(hash)}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2" data-testid="tx-link" title={hash}>
      {text}
    </a>
  ) : (
    <span className="inline-flex items-center gap-1" data-testid="tx-link" title={hash}>
      {text}
      <CopyButton value={hash} label="Copy transaction hash" />
    </span>
  );
}

const flagStyle: Record<FlagLevel, string> = {
  danger: "bg-danger-soft text-danger-fg ring-danger-border",
  warn: "bg-warning-soft text-warning-fg ring-warning-border",
  info: "bg-info-soft text-info-fg ring-info-border",
};

export function FlagBadge({ flag }: { flag: RentalFlag }) {
  return (
    <span
      data-testid="flag"
      data-level={flag.level}
      data-code={flag.code}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${flagStyle[flag.level]}`}
    >
      {flag.level === "danger" && <TriangleAlert aria-hidden className="mr-1 size-3" />}
      {flag.text}
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
  if (ts === BigInt(0)) return <span className="text-subtle">earlier</span>;
  return <span className="tabular-nums">{formatDate(ts)}</span>;
}

/** Scooter catalogue + bookings for the active chain (/api/fleet), polled like the chain data. */
export function useFleet() {
  const { chainId } = useDeployment();
  return useQuery({ queryKey: ["fleet", chainId], queryFn: () => fetchFleet(chainId), refetchInterval: 8_000 });
}
