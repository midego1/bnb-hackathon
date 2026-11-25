import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { docsUrl, REPO_URL } from "@/lib/links";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "KeyEscrow · rental deposits on BNB Chain", template: "%s · KeyEscrow" },
  description:
    "Rental deposit and rent escrow on BNB Chain: each lease gets its own escrow, rent is paid out monthly, an AI move-out inspection proposes the deposit split and a neutral dispute desk rules when the parties disagree.",
  applicationName: "KeyEscrow",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Header />
          <main className="flex flex-1 flex-col">{children}</main>
          <footer className="border-t border-slate-200 text-xs text-slate-500 dark:border-slate-800">
            <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-4">
              <span>KeyEscrow · open source (MIT) · testnet demo, no token</span>
              <a href={REPO_URL} className="underline-offset-2 hover:underline">GitHub</a>
              <a href={docsUrl("README.md")} className="underline-offset-2 hover:underline">Docs</a>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
