import type { DeepPartial } from "../locales";
import type { Dict } from "./en";
import * as more from "./zh/more";
import * as rental from "./zh/rental";
import * as roles from "./zh/roles";
import * as shell from "./zh/shell";
import * as stage from "./zh/stage";
import * as subs from "./zh/subs";

/** Simplified Chinese for dictionaries/en.ts. Terms: docs/i18n-glossary.md. A missing key falls back to English. */
export const zh: DeepPartial<Dict> = {
  lang: {
    label: "语言",
    en: "EN",
    zh: "中文",
    both: "EN+中文",
    enTitle: "English（英文）",
    zhTitle: "简体中文",
    bothTitle: "英文，标题下附中文",
  },
  skip: "跳到正文",
  meta: {
    title: "KeyEscrow · BNB Chain 上的租赁押金托管",
    description:
      "BNB Chain 上的押金与租金托管：每笔租赁都有自己的托管合约，租金按月发放，AI 验车给出押金分配建议，双方有分歧时由中立的争议处理台裁决。",
  },
  headlines: {
    aiNote: "中文内容由 AI 翻译，欢迎指正。",
    ...shell.head,
    ...roles.head,
    ...rental.head,
    ...more.head,
    ...subs.head,
    ...stage.head,
  },
  ...shell.body,
  ...roles.body,
  ...rental.body,
  ...more.body,
  ...subs.body,
  ...stage.body,
};
