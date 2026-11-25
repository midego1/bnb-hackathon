"use client";

import { useAccount } from "wagmi";
import { CreateLeaseForm } from "@/components/lease/CreateLeaseForm";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { FleetOwner } from "@/components/roles/FleetOwner";
import { OwnerSubscriptions } from "@/components/subscriptions/OwnerSubscriptions";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";
import { useT } from "@/lib/i18n/client";

export default function LandlordPage() {
  const t = useT();
  const { address } = useAccount();
  const { data } = useLeaseList("landlord", address);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.h("fleet.title")}>{t("fleet.intro")}</PageTitle>
      <WalletGate what={t("fleet.gate")}>
        <div className="space-y-8">
          <FleetOwner />
          <OwnerSubscriptions />
          <div>
            <h2 className="mb-3 text-lg font-semibold">{t.h("fleet.offerTitle")}</h2>
            <CreateLeaseForm />
          </div>
          <div>
            <h2 className="mb-3 text-lg font-semibold">{t.h("fleet.myRentals")}</h2>
            <LeaseGrid addresses={data} empty={t("fleet.rentalsEmpty")} />
          </div>
        </div>
      </WalletGate>
    </section>
  );
}
