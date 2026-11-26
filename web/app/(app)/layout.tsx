import Link from "next/link";
import { Suspense } from "react";
import { SettingsGear } from "@/components/SettingsGear";
import { AppShell } from "@/components/shell/AppShell";
import { getDictionary } from "@/lib/i18n/server";
import { docsUrl, REPO_URL } from "@/lib/links";
import { Providers } from "./providers";

/** The app: wallet providers and the left sidebar shell around every page except the marketing page at /. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const t = await getDictionary();
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
              <span>{t("shell.footer.about")}</span>
              <Link href="/" className="inline-flex items-center underline-offset-2 hover:underline" data-testid="footer-website">{t("shell.footer.website")}</Link>
              <a href={REPO_URL} className="inline-flex items-center underline-offset-2 hover:underline">GitHub</a>
              <a href={docsUrl("README.md")} className="inline-flex items-center underline-offset-2 hover:underline">{t("shell.footer.docs")}</a>
              <Link href="/how-it-works" className="inline-flex items-center underline-offset-2 hover:underline" data-testid="footer-eli5">{t("shell.footer.eli5")}</Link>
              <Link href="/media" className="inline-flex items-center underline-offset-2 hover:underline" data-testid="footer-media">{t("shell.footer.media")}</Link>
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
