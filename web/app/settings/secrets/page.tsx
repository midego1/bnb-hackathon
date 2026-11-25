import type { Metadata } from "next";
import { SecretsView } from "@/components/settings/SecretsView";

// proxy.ts answers 404 for this page unless SETTINGS_SECRETS_ENABLED=1 (local paseo-box units only).
export const metadata: Metadata = { title: "Secrets", robots: { index: false, follow: false } };

export default function SecretsPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <SecretsView />
    </section>
  );
}
