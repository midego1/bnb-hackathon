"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { Amount, Skeleton, StatusBadge } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { useLease } from "@/lib/hooks/useLease";
import { useT } from "@/lib/i18n/client";
import { nextStep, viewerRole } from "./model";

export function LeaseCard({ address }: { address: Address }) {
  const { address: me } = useAccount();
  const { data: lease, error, refetch, isFetching } = useLease(address);
  const t = useT();
  if (error && !lease)
    return (
      <div className="rounded-2xl border border-danger-border p-4 text-sm text-danger" data-testid="lease-card-error">
        {t("rental.card.error", { address: shortAddress(address) })}
        <button type="button" onClick={() => refetch()} disabled={isFetching} data-testid="chain-retry" className="underline">
          {isFetching ? t("rental.card.retrying") : t("rental.card.retry")}
        </button>
      </div>
    );
  if (!lease) return <Skeleton className="h-36" />;
  const viewer = viewerRole(lease, me);
  const other =
    viewer === "landlord"
      ? t("rental.card.renter", { address: shortAddress(lease.terms.tenant) })
      : viewer === "arbiter"
        ? t("rental.card.ownerRenter", { owner: shortAddress(lease.terms.landlord), renter: shortAddress(lease.terms.tenant) })
        : t("rental.card.owner", { address: shortAddress(lease.terms.landlord) });
  return (
    <Link
      href={`/lease/${address}`}
      data-testid="lease-card"
      data-address={address}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:border-border-hover hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t("rental.card.rental")}<span className="font-mono">{shortAddress(address)}</span></p>
          <p className="text-xs text-subtle">{other}</p>
        </div>
        <StatusBadge status={lease.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-subtle">{t("rental.card.rent")}</p>
          <Amount value={lease.terms.rentAmount} />
        </div>
        <div>
          <p className="text-xs text-subtle">{t("rental.card.deposit")}</p>
          <Amount value={lease.terms.depositAmount} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{nextStep(lease, viewer, t)}</p>
      <span className="text-xs font-medium text-subtle group-hover:text-foreground">{t("rental.card.open")}<ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" /></span>
    </Link>
  );
}

export function LeaseGrid({ addresses, empty }: { addresses: readonly Address[] | undefined; empty: React.ReactNode }) {
  if (!addresses) return <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
  if (addresses.length === 0) return <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-subtle">{empty}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {addresses.map((a) => (
        <LeaseCard key={a} address={a} />
      ))}
    </div>
  );
}
