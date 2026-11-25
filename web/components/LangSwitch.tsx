"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { LANG_COOKIE, MODES, type Mode } from "@/lib/i18n/locales";

/** Remember the choice for a year; returns the URL without `?bilingual=1`, so the explicit choice sticks. */
function remember(mode: Mode) {
  document.cookie = `${LANG_COOKIE}=${mode};path=/;max-age=31536000;samesite=lax`;
  document.documentElement.lang = mode === "zh" ? "zh-CN" : "en";
  const url = new URL(location.href);
  if (!url.searchParams.has("bilingual")) return null;
  url.searchParams.delete("bilingual");
  return url.pathname + url.search + url.hash;
}

/**
 * EN / 中文 / EN+中文. Sets the `ke_lang` cookie and re-renders from the server. On the landing header (from `sm`)
 * and footer, and in the app sidebar's footer (components/shell/AppShell.tsx).
 */
export function LangSwitch({ className = "inline-flex" }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const choose = (mode: Mode) => {
    const clean = remember(mode);
    if (clean) router.replace(clean, { scroll: false });
    else router.refresh();
  };
  return (
    <div role="group" aria-label={t("lang.label")} data-testid="lang-switch" data-lang={t.mode} className={`shrink-0 items-center rounded-full border p-0.5 text-sm ${className}`}>
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          lang={m === "zh" ? "zh-CN" : "en"}
          aria-pressed={t.mode === m}
          title={t(`lang.${m}Title`)}
          data-testid={`lang-${m}`}
          onClick={() => t.mode !== m && choose(m)}
          className={`rounded-full px-2.5 py-1 leading-none whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current ${t.mode === m ? "bg-current/15 font-semibold" : "opacity-75 hover:opacity-100"}`}
        >
          {t(`lang.${m}`)}
        </button>
      ))}
    </div>
  );
}
