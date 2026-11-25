"use client";

import { useAccount } from "wagmi";
import { Renter } from "@/components/roles/Renter";
import { RenterWelcome } from "@/components/roles/RenterWelcome";
import { WalletGate } from "@/components/WalletGate";
import { useT } from "@/lib/i18n/client";

/** Never empty: without a wallet a welcome with one live rental, with one the renter's rentals and the scooters to book. */
export default function TenantPage() {
  const { isConnected } = useAccount();
  const t = useT();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      {isConnected ? (
        <WalletGate what={t("renter.gate")}>
          <Renter />
        </WalletGate>
      ) : (
        <RenterWelcome />
      )}
    </section>
  );
}
