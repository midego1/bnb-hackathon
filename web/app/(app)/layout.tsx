import Link from "next/link";
import { Suspense } from "react";
import { SettingsGear } from "@/components/SettingsGear";
import { AppShell } from "@/components/shell/AppShell";
import { docsUrl, REPO_URL } from "@/lib/links";
import { Providers } from "./providers";

/** The app: wallet providers and the left sidebar shell around every page except the marketing page at /. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
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
              <Link href="/" className="underline-offset-2 hover:underline" data-testid="footer-website">About KeyEscrow</Link>
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
  );
}
