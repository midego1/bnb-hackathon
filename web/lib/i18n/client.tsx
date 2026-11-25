"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeT, type I18nState } from "./t";

const Ctx = createContext<I18nState | null>(null);

/** Mounted once in app/layout.tsx with the server's state (lib/i18n/server.ts stateFor). */
export function I18nProvider({ value, children }: { value: I18nState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `const t = useT(); t("lang.label"); t.h("aiNote"); t.of(demoCopy); t.head(demoCopy, (c) => c.pageTitle)`. */
export function useT() {
  const state = useContext(Ctx);
  if (!state) throw new Error("useT needs <I18nProvider> (app/layout.tsx).");
  return useMemo(() => makeT(state), [state]);
}
