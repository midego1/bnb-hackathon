import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { SettingsGear } from "@/components/SettingsGear";
import { AppShell } from "@/components/shell/AppShell";
import { docsUrl, REPO_URL } from "@/lib/links";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "KeyEscrow · rental deposits on BNB Chain", template: "%s · KeyEscrow" },
  description:
    "Rental deposit and rent escrow on BNB Chain: each rental gets its own escrow, rent is paid out monthly, an AI return inspection proposes the deposit split and a neutral dispute desk rules when the parties disagree.",
  applicationName: "KeyEscrow",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Sets the light/dark class on <html> before first paint (no flash of the wrong theme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Sets the sidebar's expanded / icon-rail state on <html> before first paint (lib/sidebar.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <Providers>
          <AppShell
            settings={
              <Suspense fallback={null}>
                <SettingsGear />
              </Suspense>
            }
            footer={
              <footer className="border-t border-border text-xs text-subtle">
                <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-4">
                  <span>KeyEscrow · open source (MIT) · testnet demo, no token</span>
                  <a href={REPO_URL} className="underline-offset-2 hover:underline">GitHub</a>
                  <a href={docsUrl("README.md")} className="underline-offset-2 hover:underline">Docs</a>
                  <Link href="/how-it-works" className="underline-offset-2 hover:underline" data-testid="footer-eli5">How it works, explained simply</Link>
                  <Suspense fallback={null}>
                    <SettingsGear variant="footer" />
                  </Suspense>
                </div>
              </footer>
            }
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
