import type { Metadata } from "next";
import { IntegrationsView } from "@/components/risk/IntegrationsView";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${(await getDictionary())("nav.integrations")} · KeyScrow` };
}

export default function IntegrationsPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <IntegrationsView />
    </section>
  );
}
