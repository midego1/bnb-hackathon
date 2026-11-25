import type { ReactNode } from "react";
import type { Dict } from "./dictionaries/en";
import type { HeadKey, Key, Vars } from "./keys";
import { fmt, langOf, type Lang, type Mode } from "./locales";

/** Shared by the server helper (server.ts) and the client hook (client.tsx): no hooks, no Next. */

export type { HeadKey, Key } from "./keys";
/** A localized data module (locales.ts `localized`). */
type ByLang<T> = (lang: Lang) => T;

/** What the server hands the client: the mode, the active dictionary and, in EN+中文, the Chinese headlines. */
export type I18nState = { mode: Mode; dict: Dict; zhHead?: Dict["headlines"] };

const at = (o: unknown, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o);

/** A headline: English, Chinese, or (EN+中文) English with the Chinese line under it (.i18n-zh in app/globals.css). */
export function bi(mode: Mode, en: ReactNode, zh: ReactNode): ReactNode {
  if (mode === "zh") return zh;
  if (mode === "en" || zh === en) return en;
  return (
    <>
      {en}
      <span className="i18n-zh" lang="zh-CN">
        {zh}
      </span>
    </>
  );
}

export function makeT({ mode, dict, zhHead }: I18nState) {
  const lang: Lang = langOf(mode);
  const str = (o: unknown, key: string, vars?: Vars) => {
    const v = at(o, key);
    return typeof v === "string" ? fmt(v, vars) : key;
  };
  /** Body text in the active language. */
  const t = (key: Key, vars?: Vars) => str(dict, key, vars);
  return Object.assign(t, {
    mode,
    lang,
    /** A headline key (dictionary `headlines`), bilingual in EN+中文. */
    h: (key: HeadKey, vars?: Vars) => (mode === "both" ? bi(mode, str(dict.headlines, key, vars), str(zhHead, key, vars)) : str(dict.headlines, key, vars)),
    /** A localized data module in the active language. */
    of: <T,>(mod: ByLang<T>) => mod(lang),
    /** A headline from a localized data module, bilingual in EN+中文: t.head(demoCopy, (c) => c.pageTitle). */
    head: <T,>(mod: ByLang<T>, pick: (c: T) => ReactNode) => (mode === "both" ? bi(mode, pick(mod("en")), pick(mod("zh"))) : pick(mod(lang))),
  });
}
export type T = ReturnType<typeof makeT>;
