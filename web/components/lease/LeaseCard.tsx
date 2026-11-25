"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { Amount, Skeleton, StatusBadge } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { useLease } from "@/lib/hooks/useLease";
import { nextStep, viewerRole } from "./model";

export function LeaseCard({ address }: { address: Address }) {
  const { address: me } = useAccount();
  const { data: lease, error } = useLease(address);
  if (error) return <div className="rounded-2xl border border-rose-200 p-4 text-sm text-rose-700">Could not load lease {shortAddress(address)}. Check that your wallet is on the right network.</div>;
  if (!lease) return <Skeleton className="h-36" />;
  const viewer = viewerRole(lease, me);
  const other =
    viewer === "landlord"
      ? `Tenant ${shortAddress(lease.terms.tenant)}`
      : viewer === "arbiter"
        ? `Landlord ${shortAddress(lease.terms.landlord)} · tenant ${shortAddress(lease.terms.tenant)}`
        : `Landlord ${shortAddress(lease.terms.landlord)}`;
  return (
    <Link
      href={`/lease/${address}`}
      data-testid="lease-card"
      data-address={address}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Lease <span className="font-mono">{shortAddress(address)}</span></p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{other}</p>
        </div>
        <StatusBadge status={lease.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Rent / month</p>
          <Amount value={lease.terms.rentAmount} />
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Deposit</p>
          <Amount value={lease.terms.depositAmount} />
        </div>
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-300">{nextStep(lease, viewer)}</p>
      <span className="text-xs font-medium text-slate-500 group-hover:text-slate-900 dark:group-hover:text-white">Open lease →</span>
    </Link>
  );
}

export function LeaseGrid({ addresses, empty }: { addresses: readonly Address[] | undefined; empty: React.ReactNode }) {
  if (!addresses) return <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
  if (addresses.length === 0) return <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">{empty}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {addresses.map((a) => (
        <LeaseCard key={a} address={a} />
      ))}
    </div>
  );
}
