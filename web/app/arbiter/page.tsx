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
        Leases where this wallet is the arbiter. Disputed ones need a ruling: choose the split and record the written reasons.
      </PageTitle>
      <WalletGate what="see the leases you arbitrate">
        {isDesk && <div className="mb-4"><Notice>You are connected as the KeyEscrow dispute desk, the default arbiter for new leases.</Notice></div>}
        {!data ? (
          <Skeleton className="h-36" />
        ) : data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No leases name this wallet as arbiter.</p>
        ) : (
          <div className="space-y-8">
            <Section title="Needs a ruling" addresses={data} want="disputed" />
            <Section title="Other leases" addresses={data} want="other" />
          </div>
        )}
      </WalletGate>
    </section>
  );
}

function Section({ title, addresses, want }: { title: string; addresses: readonly Address[]; want: "disputed" | "other" }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {addresses.map((a) => (
          <Filtered key={a} address={a} want={want} />
        ))}
      </div>
    </div>
  );
}

function Filtered({ address, want }: { address: Address; want: "disputed" | "other" }) {
  const { data } = useLease(address);
  if (!data) return null;
  const disputed = data.status === LeaseStatus.Disputed;
  if ((want === "disputed") !== disputed) return null;
  return <LeaseCard address={address} />;
}
