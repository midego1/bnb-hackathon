import type { Dict } from "./dictionaries/en";
import type { Lang } from "./locales";

/** The dictionary's key types, JSX-free so shared lib code (and the agent, which type-checks it) can use them. */

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends object ? Leaves<T[K], `${P}${K}.`> : never;
}[keyof T & string];
export type Key = Leaves<Omit<Dict, "headlines">>;
export type HeadKey = Leaves<Dict["headlines"]>;
export type Vars = Record<string, string | number>;

/** The part of t.tsx's `T` that plain lib code needs: body strings and the language. */
export type Translate = ((key: Key, vars?: Vars) => string) & { lang: Lang };
