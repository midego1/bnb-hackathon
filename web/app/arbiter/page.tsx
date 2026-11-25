"use client";

import { useAccount } from "wagmi";
import { LeaseCard } from "@/components/lease/LeaseCard";
import { Notice, PageTitle, Skeleton } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { LeaseStatus } from "@/lib/contracts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useLease, useLeaseList } from "@/lib/hooks/useLease";
import type { Address } from "viem";

export default function ArbiterPage() {
  const { address } = useAccount();
  const { deployment } = useDeployment();
  const { data } = useLeaseList("arbiter", address);
  const isDesk = !!address && deployment?.disputeDesk?.toLowerCase() === address.toLowerCase();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Dispute desk">
        Leases where this wallet is the neutral reviewer. When landlord and tenant can&apos;t agree on the deposit, you decide the
        split and write down why. If you miss the deadline, the full deposit goes back to the tenant.
      </PageTitle>
      <WalletGate what="see the leases you arbitrate">
        {isDesk && <div className="mb-4"><Notice>You are connected as the KeyEscrow dispute desk, the default reviewer for every new lease.</Notice></div>}
        {!data ? (
          <Skeleton className="h-36" />
        ) : data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No leases name this wallet as their dispute desk. Landlords pick the reviewer when they create a lease; the KeyEscrow dispute desk is the default.</p>
        ) : (
          <div className="space-y-8">
            <Section title="Needs a ruling" addresses={data} want="disputed" empty="Nothing to rule on. Disputed leases show up here." />
            <Section title="Other leases" addresses={data} want="other" empty="No other leases." />
          </div>
        )}
      </WalletGate>
    </section>
  );
}

function Section({ title, addresses, want, empty }: { title: string; addresses: readonly Address[]; want: "disputed" | "other"; empty: string }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {addresses.map((a) => (
          <Filtered key={a} address={a} want={want} />
        ))}
        {/* Shown only when no card rendered above (each Filtered renders nothing for leases of the other group). */}
        <p className="hidden rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 only:block sm:col-span-2 dark:border-slate-700">
          {empty}
        </p>
      </div>
    </div>
  );
}

function Filtered({ address, want }: { address: Address; want: "disputed" | "other" }) {
  const { data } = useLease(address);
  if (!data) return want === "disputed" ? <Skeleton className="h-36" /> : null;
  const disputed = data.status === LeaseStatus.Disputed;
  if ((want === "disputed") !== disputed) return null;
  return <LeaseCard address={address} />;
}
