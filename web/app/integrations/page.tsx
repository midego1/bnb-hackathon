import type { Metadata } from "next";
import { IntegrationsView } from "@/components/risk/IntegrationsView";

export const metadata: Metadata = { title: "Integrations · KeyEscrow" };

export default function IntegrationsPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <IntegrationsView />
    </section>
  );
}
