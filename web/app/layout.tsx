import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/client";
import { LANG_INIT_SCRIPT } from "@/lib/i18n/locales";
import { getDictionary, getMode, stateFor } from "@/lib/i18n/server";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Public origin of the deployed site (optional, e.g. https://keyescrow.example): makes the social-card image URL absolute. */
const siteUrl = process.env.SITE_URL;

/** Phones: draw under the notch / home bar (pages pad with env(safe-area-inset-*)); the keyboard shrinks the page, so a
 * focused input or the Ask AI composer is never hidden behind it. */
export const viewport: Viewport = { viewportFit: "cover", interactiveWidget: "resizes-content" };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  return {
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
    title: { default: t("meta.title"), template: "%s · KeyScrow" },
    description: t("meta.description"),
    applicationName: "KeyScrow",
  };
}

/**
 * Root: <html> (its lang follows the ke_lang cookie), the theme, sidebar and language boot scripts, the fonts and the
 * language provider (lib/i18n). The marketing page at / renders straight into it
 * (app/(marketing)); every app page gets the wallet providers and the sidebar shell from app/(app)/layout.tsx.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The ke_lang cookie makes every page request-time; read here, outside Suspense, so the HTML streams in order.
  const mode = await getMode();
  return (
    <html lang={mode === "zh" ? "zh-CN" : "en"} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Sets the light/dark class on <html> before first paint (no flash of the wrong theme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Sets the sidebar's expanded / icon-rail state on <html> before first paint (lib/sidebar.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
        {/* ?bilingual=1: EN+中文 for a presenter (lib/i18n/locales.ts). */}
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <I18nProvider value={stateFor(mode)}>{children}</I18nProvider>
      </body>
    </html>
  );
}
