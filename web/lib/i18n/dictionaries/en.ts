/**
 * The core dictionary: short UI strings, JSON only (`{name}` placeholders), so the server can hand the active
 * language to the client as plain props. Longer copy with logic lives in localized data modules next to the
 * code that uses it (lib/i18n/locales.ts `localized`).
 *
 * `headlines` is the one place for keys that are headlines: in EN+中文 mode they get the Chinese line under the
 * English (t.h). Everything outside `headlines` is body text and stays English in that mode.
 */
export const en = {
  lang: {
    label: "Language",
    en: "EN",
    zh: "中文",
    both: "EN+中文",
    enTitle: "English",
    zhTitle: "简体中文 (Simplified Chinese)",
    bothTitle: "English, with Chinese under the headlines",
  },
  skip: "Skip to content",
  meta: {
    title: "KeyEscrow · rental deposits on BNB Chain",
    description:
      "Rental deposit and rent escrow on BNB Chain: each rental gets its own escrow, rent is paid out monthly, an AI return inspection proposes the deposit split and a neutral dispute desk rules when the parties disagree.",
  },
  headlines: {
    /** Shown in 中文 and EN+中文 only. */
    aiNote: "The Chinese text is AI-translated; corrections welcome.",
  },
};

export type Dict = typeof en;
