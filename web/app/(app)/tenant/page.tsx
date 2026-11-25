"use client";

import { useAccount } from "wagmi";
import { Renter } from "@/components/roles/Renter";
import { RenterWelcome } from "@/components/roles/RenterWelcome";
import { WalletGate } from "@/components/WalletGate";

/** Never empty: without a wallet a welcome with one live rental, with one the renter's rentals and the scooters to book. */
export default function TenantPage() {
  const { isConnected } = useAccount();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      {isConnected ? (
        <WalletGate what="see your rentals">
          <Renter />
        </WalletGate>
      ) : (
        <RenterWelcome />
      )}
    </section>
  );
}
