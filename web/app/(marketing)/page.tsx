import type { Metadata } from "next";
import localFont from "next/font/local";
import { Hero, SiteHeader } from "@/components/marketing/Hero";
import { Agents, ClosingCta, Counter, Deadlines, Fee, FleetVault, HowItWorks, Inspection, Live, Roadmap, SiteFooter } from "@/components/marketing/Sections";
import { demoAvailable } from "@/components/shell/nav";
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

const title = "KeyEscrow: rent a scooter in Thailand without leaving your passport";
const description =
  "The deposit for a scooter rental sits in a smart contract on BNB Chain instead of a passport at the counter. An AI inspection proposes the split at return, both sides agree or a dispute desk rules, and deadlines protect the renter. Live on BSC testnet.";
const card = { url: "/marketing/og.jpg", width: 1200, height: 630, alt: "KeyEscrow: rent the scooter, keep your passport. An LED picture of a scooter rental shop on a Thai street at night." };

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "KeyEscrow", title, description, url: "/", images: [card] },
  twitter: { card: "summary_large_image", title, description, images: [card] },
};

/**
 * The marketing page: static, no wallet, no providers. A server component whose only client code is the theme button
 * and Next's links. The app itself starts at /app (and the role pages).
 */
export default function LandingPage() {
  return (
    <div className={`mk ${display.variable} bg-background text-foreground`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-[var(--mk-amber)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[#1b1236]"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero demo={demoAvailable} />
        <Counter />
        <HowItWorks />
        <Inspection />
        <Deadlines />
        <FleetVault />
        <Agents />
        <Live />
        <Fee />
        <Roadmap />
        <ClosingCta demo={demoAvailable} />
      </main>
      <SiteFooter demo={demoAvailable} />
    </div>
  );
}
