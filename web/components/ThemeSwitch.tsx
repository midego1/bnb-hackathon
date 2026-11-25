"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { getThemePrefSnapshot, setThemePref, subscribeTheme, THEME_PREFS, type ThemePref } from "@/lib/theme";

const LABEL: Record<ThemePref, string> = { light: "Light", dark: "Dark", system: "System" };

const ICON: Record<ThemePref, ReactNode> = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  dark: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
};

const Icon = ({ pref }: { pref: ThemePref }) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {ICON[pref]}
  </svg>
);

/** Compact variant for narrow screens: one button that cycles Light -> Dark -> System. */
export function ThemeCycleButton({ className = "" }: { className?: string }) {
  const pref = useSyncExternalStore(subscribeTheme, getThemePrefSnapshot, () => null) ?? "system";
  const next = THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
  return (
    <button
      type="button"
      data-testid="theme-cycle"
      data-theme-pref={pref}
      aria-label={`Color theme: ${LABEL[pref]}. Switch to ${LABEL[next]}`}
      title={`${LABEL[pref]} theme`}
      onClick={() => setThemePref(next)}
      className={`h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${className}`}
    >
      <Icon pref={pref} />
    </button>
  );
}

/** Light / Dark / System segmented control (a radio group: arrow keys move between options). */
export function ThemeSwitch({ className = "inline-flex" }: { className?: string }) {
  // The server cannot know the stored choice: render "system" there and on hydration, then the real value.
  const pref = useSyncExternalStore(subscribeTheme, getThemePrefSnapshot, () => null);

  const move = (group: HTMLElement | null, from: ThemePref, step: number) => {
    const next = THEME_PREFS[(THEME_PREFS.indexOf(from) + step + THEME_PREFS.length) % THEME_PREFS.length];
    setThemePref(next);
    group?.querySelector<HTMLButtonElement>(`[data-theme-option="${next}"]`)?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Color theme" data-testid="theme-switch" className={`shrink-0 items-center rounded-lg border border-border bg-muted p-0.5 ${className}`}>
      {THEME_PREFS.map((p) => {
        const checked = (pref ?? "system") === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${LABEL[p]} theme`}
            title={`${LABEL[p]} theme`}
            data-theme-option={p}
            tabIndex={checked ? 0 : -1}
            onClick={() => setThemePref(p)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(e.currentTarget.parentElement, p, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(e.currentTarget.parentElement, p, -1);
              }
            }}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
              checked ? "bg-surface text-foreground shadow-sm ring-1 ring-inset ring-border-strong" : "text-subtle hover:text-foreground"
            }`}
          >
            <Icon pref={p} />
          </button>
        );
      })}
    </div>
  );
}
