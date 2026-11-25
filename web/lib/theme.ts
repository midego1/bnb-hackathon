/**
 * Light / dark / system theme. The choice is kept in localStorage under THEME_STORAGE_KEY; <html> gets
 * class "light" or "dark" (the resolved theme, which drives Tailwind's `dark:` variant and the CSS tokens
 * in app/globals.css) and data-theme with the stored preference. THEME_INIT_SCRIPT runs inline in <head>
 * before first paint, so the page never flashes the wrong theme.
 */
export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "keyescrow-theme";
export const THEME_PREFS: readonly ThemePref[] = ["light", "dark", "system"];

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

/** Applies the stored preference to <html>. Self-contained: it is stringified into the inline <head> script. */
function applyTheme(key: string, forced?: string) {
  let pref: string | null = forced ?? null;
  if (!pref) {
    try {
      pref = window.localStorage.getItem(key);
    } catch {}
  }
  if (pref !== "light" && pref !== "dark") pref = "system";
  let dark = pref === "dark";
  if (pref === "system") {
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {}
  }
  const root = document.documentElement;
  root.classList.remove(dark ? "light" : "dark");
  root.classList.add(dark ? "dark" : "light");
  root.dataset.theme = pref;
  root.style.colorScheme = dark ? "dark" : "light";
}

export const THEME_INIT_SCRIPT = `(${applyTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)})`;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {}
  // Applied from the argument, so the choice holds for this page view even when storage is unavailable.
  applyTheme(THEME_STORAGE_KEY, pref);
  notify();
}

/** useSyncExternalStore subscription: preference changes, OS scheme changes and other tabs. */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (document.documentElement.dataset.theme === "system") applyTheme(THEME_STORAGE_KEY, "system");
    notify();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) {
      applyTheme(THEME_STORAGE_KEY);
      notify();
    }
  };
  media.addEventListener("change", onMedia);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}

export const getThemePrefSnapshot = (): ThemePref => {
  const v = document.documentElement.dataset.theme;
  return isPref(v) ? v : "system";
};
export const getResolvedThemeSnapshot = (): ResolvedTheme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
