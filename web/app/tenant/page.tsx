"use client";

import { useAccount } from "wagmi";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";

const steps = [
  ["Fund", "Approve and pay the deposit plus the first month's rent into the lease's own escrow."],
  ["Live", "Rent is released to the landlord month by month. You can prepay or release early."],
  ["Move out", "Upload check-out photos. The AI inspector proposes a split; one side proposes, the other accepts."],
  ["Disagree?", "Open a dispute and the arbiter rules. The landlord can never take the deposit alone."],
];

export default function TenantPage() {
  const { address } = useAccount();
  const { data } = useLeaseList("tenant", address);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Tenant">Your deposit sits in a contract only you and your landlord can settle, with an arbiter as fallback.</PageTitle>
      <ol className="mb-8 grid gap-3 sm:grid-cols-4">
        {steps.map(([t, b], i) => (
          <li key={t} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="font-semibold">
              {i + 1}. {t}
            </p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">{b}</p>
          </li>
        ))}
      </ol>
      <WalletGate what="see the leases offered to you">
        <h2 className="mb-3 text-lg font-semibold">My leases</h2>
        <LeaseGrid addresses={data} empty="No leases for this wallet yet. Ask your landlord to create one for your address." />
      </WalletGate>
    </section>
  );
}
