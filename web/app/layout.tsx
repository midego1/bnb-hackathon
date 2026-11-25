import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Public origin of the deployed site (optional, e.g. https://keyescrow.example): makes the social-card image URL absolute. */
const siteUrl = process.env.SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: "KeyEscrow · rental deposits on BNB Chain", template: "%s · KeyEscrow" },
  description:
    "Rental deposit and rent escrow on BNB Chain: each rental gets its own escrow, rent is paid out monthly, an AI return inspection proposes the deposit split and a neutral dispute desk rules when the parties disagree.",
  applicationName: "KeyEscrow",
};

/**
 * Root: <html>, the theme and sidebar boot scripts and the fonts. The marketing page at / renders straight into it
 * (app/(marketing)); every app page gets the wallet providers and the sidebar shell from app/(app)/layout.tsx.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Sets the light/dark class on <html> before first paint (no flash of the wrong theme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Sets the sidebar's expanded / icon-rail state on <html> before first paint (lib/sidebar.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
