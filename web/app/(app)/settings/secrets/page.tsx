import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SecretsView } from "@/components/settings/SecretsView";
import { getDictionary } from "@/lib/i18n/server";
import { secretsPageAllowed } from "@/lib/server/secrets/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary())("secrets.metaTitle"), robots: { index: false, follow: false } };
}

/**
 * The write-only secrets page. Guarded here rather than in a proxy (a proxy makes the Cloudflare Worker bundle a second
 * handler, ~0.2 MiB gzip): not found unless SETTINGS_SECRETS_ENABLED=1 (local paseo-box units only) and the request
 * comes from this machine or the tailnet. The API routes check again; security headers come from next.config.ts.
 * The guard runs before anything streams, so a refusal is a real 404 page, not an empty one.
 */
export default async function SecretsPage() {
  await connection(); // runtime env and request headers, not the build's
  if (!secretsPageAllowed(await headers(), process.env)) notFound();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <SecretsView />
    </section>
  );
}
