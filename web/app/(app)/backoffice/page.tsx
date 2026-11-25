import { BackOffice } from "@/components/roles/BackOffice";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Back office" };

export default function BackOfficePage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <PageTitle title="Back office">
        Every rental and every on-chain transaction as it happens, read straight from the contracts&apos; events: deposits locked, rent
        paid, pickup and return inspections, AI verdicts, payouts and slashes, and Fleet Vault inflows. Anything stuck, failed or disputed
        is flagged.
      </PageTitle>
      <BackOffice />
    </section>
  );
}
