"use client";

import { useAccount } from "wagmi";
import { CreateLeaseForm } from "@/components/lease/CreateLeaseForm";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { FleetOwner } from "@/components/roles/FleetOwner";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";

export default function LandlordPage() {
  const { address } = useAccount();
  const { data } = useLeaseList("landlord", address);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Fleet owner">
        Your scooters with live status, income, booking requests, active rentals and disputes. Once a renter funds a rental, the deposit
        stays locked in that rental&apos;s escrow and rent is paid out to you (or the Fleet Vault) every month.
      </PageTitle>
      <WalletGate what="offer and manage scooter rentals">
        <div className="space-y-8">
          <FleetOwner />
          <div>
            <h2 className="mb-3 text-lg font-semibold">My rentals</h2>
            <LeaseGrid addresses={data} empty="No rentals yet. Accept a booking request or fill in the form below to offer your first one; it shows up here as soon as it is created." />
          </div>
          <div>
            <h2 className="mb-3 text-lg font-semibold">Offer a rental to a specific wallet</h2>
            <CreateLeaseForm />
          </div>
        </div>
      </WalletGate>
    </section>
  );
}
