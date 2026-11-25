"use client";

import { useAccount } from "wagmi";
import { CreateLeaseForm } from "@/components/lease/CreateLeaseForm";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";

export default function LandlordPage() {
  const { address } = useAccount();
  const { data } = useLeaseList("landlord", address);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Landlord">
        Offer a lease to your tenant&apos;s wallet. Once they fund it, the deposit stays locked in that lease&apos;s escrow and rent is paid
        out to you every month.
      </PageTitle>
      <WalletGate what="create and manage leases">
        <div className="space-y-8">
          <CreateLeaseForm />
          <div>
            <h2 className="mb-3 text-lg font-semibold">My leases</h2>
            <LeaseGrid addresses={data} empty="No leases yet. Fill in the form above to offer your first one; it shows up here as soon as it is created." />
          </div>
        </div>
      </WalletGate>
    </section>
  );
}
