import { Shareholders } from "@/components/roles/Shareholders";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Shareholders" };

export default function ShareholdersPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Shareholders">
        Own part of a scooter fleet. Deposit test USDT into the Fleet Vault and get BKK-FLEET-1 shares; rent from completed rentals and
        damage payouts from slashed deposits flow in, minus the operator&apos;s maintenance fee, and you claim your share. Testnet prototype,
        not an offer of securities.
      </PageTitle>
      <Shareholders />
    </section>
  );
}
