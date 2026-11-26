"use client";

import { useAccount } from "wagmi";
import { CreateLeaseForm } from "@/components/lease/CreateLeaseForm";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { FleetOwner } from "@/components/roles/FleetOwner";
import { EarlierRentals } from "@/components/roles/shared";
import { OwnerSubscriptions } from "@/components/subscriptions/OwnerSubscriptions";
import { PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";
import { useRentals } from "@/lib/hooks/useRentals";
import { useT } from "@/lib/i18n/client";
import { splitRentals } from "@/lib/rentals";

export default function LandlordPage() {
  const t = useT();
  const { address } = useAccount();
  const { data } = useLeaseList("landlord", address);
  // Statuses come from the chain index FleetOwner already reads; a rental it has not indexed yet counts as open.
  const { data: index } = useRentals();
  const status = new Map(index?.rentals.map((r) => [r.address.toLowerCase(), r.status]));
  const { open, earlier } = splitRentals(data ?? [], (a) => status.get(a.toLowerCase()));
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
            <LeaseGrid addresses={data && open} empty={data?.length ? t("roles.noOpen") : t("fleet.rentalsEmpty")} />
            {earlier.length > 0 && (
              <EarlierRentals n={earlier.length} testId="owner-earlier">
                <LeaseGrid addresses={earlier} empty={null} />
              </EarlierRentals>
            )}
          </div>
        </div>
      </WalletGate>
    </section>
  );
}
