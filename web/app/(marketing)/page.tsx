import type { Metadata } from "next";
import localFont from "next/font/local";
import { Hero, SiteHeader } from "@/components/marketing/Hero";
import { Agents, ClosingCta, Counter, Deadlines, Fee, Flow, Inspection, Listings, Live, Roadmap, Shops, SiteFooter } from "@/components/marketing/Sections";
import { landingCopy } from "@/components/marketing/copy";
import { demoAvailable } from "@/components/shell/nav";
import { getDictionary } from "@/lib/i18n/server";
import { parseSearch } from "@/lib/marketing";
import "./landing.css";

/** Kanit (Cadson Demak, OFL): the display face, self-hosted. Latin subset, two weights. */
const display = localFont({
  src: [
    { path: "./fonts/kanit-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/kanit-800-latin.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { title, description, cardAlt } = (await getDictionary()).of(landingCopy).meta;
  const card = { url: "/marketing/og-v2.jpg", width: 1200, height: 630, alt: cardAlt };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: "KeyScrow", title, description, url: "/", images: [card] },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

/**
 * The marketing page: no wallet, no providers. A server component whose only client code is the theme button, the
 * language switch, the search (components/marketing/Search.tsx), the money board (MoneyFlow.tsx) and Next's links.
 * Rendered per request: the words follow the ke_lang cookie (lib/i18n) and the grid follows the search in the address.
 * The app itself starts at /app (and the role pages).
 *
 * The story, top to bottom: find a scooter (the search and the demo listings it filters, from ?where=&when=&how=),
 * why the deposit is safe (the comparison, the money board, who decides, the deadlines), listing your own scooter,
 * proof that it is real, the agent surface, the fee, what is only planned, and the three ways in.
 */
export default async function LandingPage({ searchParams }: PageProps<"/">) {
  const t = await getDictionary();
  const search = parseSearch(await searchParams);
  return (
    <div className={`mk ${display.variable} bg-background text-foreground`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-[var(--mk-amber)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[#1b1236]"
      >
        {t("skip")}
      </a>
      <SiteHeader />
      <main id="main">
        <Hero demo={demoAvailable} search={search} />
        <Listings search={search} />
        <Counter />
        <Flow demo={demoAvailable} />
        <Inspection />
        <Deadlines />
        <Shops />
        <Live />
        <Agents />
        <Fee />
        <Roadmap />
        <ClosingCta demo={demoAvailable} />
      </main>
      <SiteFooter demo={demoAvailable} />
    </div>
  );
}
