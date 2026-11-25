"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getThemePrefSnapshot, setThemePref, subscribeTheme, THEME_PREFS, type ThemePref } from "@/lib/theme";

const LABEL: Record<ThemePref, string> = { light: "Light", dark: "Dark", system: "System" };

const ICON: Record<ThemePref, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

const Icon = ({ pref }: { pref: ThemePref }) => {
  const Svg = ICON[pref];
  return <Svg aria-hidden className="h-4 w-4" />;
};

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
