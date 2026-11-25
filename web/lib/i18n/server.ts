import { cookies } from "next/headers";
import { cache } from "react";
import { en } from "./dictionaries/en";
import { zh } from "./dictionaries/zh";
import { LANG_COOKIE, parseMode, withFallback, type Mode } from "./locales";
import { makeT, type I18nState } from "./t";

const zhFull = withFallback(en, zh);

/** The visitor's mode from the `ke_lang` cookie (en when unset), once per request. */
export const getMode = cache(async (): Promise<Mode> => parseMode((await cookies()).get(LANG_COOKIE)?.value));

/** What the client provider gets: only the active language, plus the Chinese headlines in EN+中文. */
export function stateFor(mode: Mode): I18nState {
  if (mode === "zh") return { mode, dict: zhFull };
  return mode === "both" ? { mode, dict: en, zhHead: zhFull.headlines } : { mode, dict: en };
}

/** For server components: `const t = await getDictionary(); t("skip"); t.h("aiNote"); t.of(module)`. */
export async function getDictionary() {
  return makeT(stateFor(await getMode()));
}
