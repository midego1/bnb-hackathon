/**
 * The language modes and the small pure helpers behind them. No React, no Next: safe on the server, the client and in tests.
 *
 * - `en`: English (the default).
 * - `zh`: Simplified Chinese everywhere it is translated, English where a key is still missing.
 * - `both`: English, with the Chinese line added under headlines only (for a presenter with a mixed audience).
 *
 * The mode lives in the `ke_lang` cookie (no URL change). `?bilingual=1` switches to `both` (BILINGUAL_INIT_SCRIPT). Glossary of the fixed Chinese terms: docs/i18n-glossary.md.
 */

export const LANG_COOKIE = "ke_lang";
export const MODES = ["en", "zh", "both"] as const;
export type Mode = (typeof MODES)[number];
/** The language body text is written in: `both` reads English. */
export type Lang = "en" | "zh";

export const parseMode = (value: string | null | undefined): Mode => (MODES as readonly string[]).includes(value ?? "") ? (value as Mode) : "en";
export const langOf = (mode: Mode): Lang => (mode === "zh" ? "zh" : "en");

/** A translation of T: any key may be missing; string literals widen to string. */
export type DeepPartial<T> = T extends string
  ? string
  : T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `zh` over `en`: any key the translation lacks falls back to English. Strings, functions and arrays are leaves. */
export function withFallback<T>(en: T, zh: DeepPartial<NoInfer<T>> | undefined): T {
  if (zh === undefined) return en;
  if (!isPlain(en) || !isPlain(zh)) return zh as T;
  const out: Record<string, unknown> = { ...en };
  for (const k of Object.keys(en)) out[k] = withFallback(en[k], zh[k] as never);
  return out as T;
}

/** Dotted paths of every leaf in `en` that `zh` lacks (tests/i18n.test.ts fails on any). */
export function missingKeys(en: unknown, zh: unknown, prefix = ""): string[] {
  if (en === undefined) return [];
  if (!isPlain(en)) return zh === undefined ? [prefix] : [];
  if (!isPlain(zh)) return [prefix || "(root)"];
  return Object.keys(en).flatMap((k) => missingKeys(en[k], zh[k], prefix ? `${prefix}.${k}` : k));
}

/** A data module's English and Chinese, as one getter by language. */
export function localized<T>(en: T, zh: DeepPartial<NoInfer<T>>) {
  const merged = withFallback(en, zh);
  const get = (lang: Lang) => (lang === "zh" ? merged : en);
  return Object.assign(get, { en, zh });
}
export type Localized<T> = ((lang: Lang) => T) & { en: T; zh: DeepPartial<T> };

/** "Step {n} of {total}" + { n: 1, total: 9 }. Unknown placeholders stay as they are. */
export const fmt = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/**
 * Runs in <head> before first paint: `?bilingual=1` turns on EN+中文 (set the cookie, reload once; the server renders
 * by cookie). The language switch drops the parameter again, so an explicit choice sticks.
 */
export const LANG_INIT_SCRIPT = `(function(){try{if(/[?&]bilingual=1(&|$)/.test(location.search)&&!/(^|; )${LANG_COOKIE}=both(;|$)/.test(document.cookie)){document.cookie="${LANG_COOKIE}=both;path=/;max-age=31536000;samesite=lax";location.reload()}}catch(e){}})()`;
