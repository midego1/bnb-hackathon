import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { demoCopy } from "@/components/demo/copy";
import { eli5Copy, endingsText, sceneText, story } from "@/components/eli5/script";
import { landingCopy } from "@/components/marketing/copy";
import { SLASH_COMMANDS, suggestionsFor, ZH_LABELS } from "@/lib/assistant/composer";
import { explain } from "@/lib/demo/explain";
import { paths, propertyName, PROPERTIES, stepsFor, stepText, txLabel } from "@/lib/demo/script";
import { EN_ERRORS, friendlyError } from "@/lib/errors";
import { errorsIn, zhErrors } from "@/lib/errors.zh";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { fmt, LANG_INIT_SCRIPT, langOf, missingKeys, parseMode, withFallback } from "@/lib/i18n/locales";
import { stateFor } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";

describe("language mode", () => {
  it("reads the ke_lang cookie value, English for anything unknown", () => {
    expect(parseMode("zh")).toBe("zh");
    expect(parseMode("both")).toBe("both");
    expect(parseMode("en")).toBe("en");
    for (const v of [undefined, null, "", "fr", "ZH", "zh-CN"]) expect(parseMode(v)).toBe("en");
  });

  it("EN+中文 reads English body text", () => {
    expect([langOf("en"), langOf("zh"), langOf("both")]).toEqual(["en", "zh", "en"]);
  });

  it("?bilingual=1 sets the cookie to both, once", () => {
    const run = (cookie: string, search = "") => {
      const doc = { cookie };
      let reloaded = false;
      new Function("document", "location", LANG_INIT_SCRIPT)(doc, { search, reload: () => (reloaded = true) });
      return { cookie: doc.cookie, reloaded };
    };
    expect(run("ke_lang=zh").reloaded).toBe(false);
    expect(run("ke_lang=en", "?bilingual=1")).toMatchObject({ reloaded: true, cookie: expect.stringContaining("ke_lang=both") });
    expect(run("a=1", "?bilingual=1&x=2").reloaded).toBe(true);
    expect(run("ke_lang=both", "?x=1&bilingual=1").reloaded).toBe(false);
  });

  it("sends the client only the active language", () => {
    expect(stateFor("en")).toEqual({ mode: "en", dict: en });
    const z = stateFor("zh");
    expect(z.dict.skip).toBe(zh.skip);
    expect(z.zhHead).toBeUndefined();
    const b = stateFor("both");
    expect(b.dict).toBe(en);
    expect(b.zhHead?.aiNote).toBe(zh.headlines?.aiNote);
  });
});

describe("fallback", () => {
  it("fills keys the translation lacks from English", () => {
    const base = { a: "A", b: { c: "C", d: "D" }, f: (n: number) => `n=${n}`, list: ["x", "y"] };
    const merged = withFallback(base, { b: { c: "丙" }, list: ["甲"] });
    expect(merged.a).toBe("A");
    expect(merged.b).toEqual({ c: "丙", d: "D" });
    expect(merged.f(2)).toBe("n=2");
    expect(merged.list).toEqual(["甲"]);
    expect(missingKeys(base, { b: { c: "丙" }, list: ["甲"] })).toEqual(["a", "b.d", "f"]);
  });

  it("t(): placeholders, unknown keys and headlines per mode", () => {
    expect(fmt("Step {n} of {total}", { n: 1, total: 9 })).toBe("Step 1 of 9");
    expect(fmt("{x} stays", {})).toBe("{x} stays");
    expect(makeT(stateFor("zh"))("lang.label")).toBe("语言");
    expect(makeT(stateFor("en"))("lang.label")).toBe("Language");
    expect(makeT(stateFor("zh")).h("aiNote")).toBe(zh.headlines?.aiNote);
    expect(makeT(stateFor("en")).h("aiNote")).toBe(en.headlines.aiNote);
    expect(isValidElement(makeT(stateFor("both")).h("aiNote"))).toBe(true);
    expect(isValidElement(makeT(stateFor("both")).head(demoCopy, (c) => c.pageTitle))).toBe(true);
    expect(makeT(stateFor("zh")).head(demoCopy, (c) => c.pageTitle)).toBe("播放演示");
  });
});

describe("key parity: every English string has Chinese", () => {
  const modules = {
    dictionary: [en, zh],
    demoCopy: [demoCopy.en, demoCopy.zh],
    demoPaths: [paths.en, paths.zh],
    demoSteps: [stepText.en, stepText.zh],
    // `to` (who receives) is data, not words.
    guidedNarration: [Object.fromEntries(Object.entries(explain.en).map(([id, x]) => [id, { now: x.now, changed: x.changed }])), explain.zh],
    eli5Scenes: [sceneText.en, sceneText.zh],
    eli5Endings: [endingsText.en, endingsText.zh],
    eli5Copy: [eli5Copy.en, eli5Copy.zh],
    landing: [landingCopy.en, landingCopy.zh],
    errors: [EN_ERRORS, zhErrors],
  } as const;

  for (const [name, [english, chinese]] of Object.entries(modules)) {
    it(name, () => {
      // The list is the to-do for the translator.
      expect(missingKeys(english, chinese)).toEqual([]);
    });
  }

  it("Ask AI suggestion labels and command descriptions", () => {
    const paths = ["/", "/tenant", "/landlord", "/arbiter", "/demo", "/lease/0x0000000000000000000000000000000000000001"];
    const english = [...paths.flatMap((p) => suggestionsFor(p).map((s) => s.label)), ...SLASH_COMMANDS.map((c) => c.description)];
    expect(english.filter((s) => !ZH_LABELS[s])).toEqual([]);
  });

  it("arrays keep their length (lines, rows, bullets)", () => {
    expect(landingCopy("zh").counter.rows).toHaveLength(landingCopy.en.counter.rows.length);
    expect(landingCopy("zh").roadmap.phases).toHaveLength(landingCopy.en.roadmap.phases.length);
    expect(landingCopy("zh").fee.rows).toHaveLength(landingCopy.en.fee.rows.length);
    expect(demoCopy("zh").intro.bullets).toHaveLength(demoCopy.en.intro.bullets.length);
    expect(endingsText("zh").map((e) => e.id)).toEqual(endingsText.en.map((e) => e.id));
  });
});

describe("localized data stays in step with the English", () => {
  it("demo steps: same ids and actors, Chinese titles", () => {
    for (const p of ["happy", "dispute", "timeout", "fleet"] as const) {
      const a = stepsFor(p);
      const b = stepsFor(p, "zh");
      expect(b.map((s) => [s.id, s.actor, !!s.demoOnly])).toEqual(a.map((s) => [s.id, s.actor, !!s.demoOnly]));
      for (const s of b) expect(s.title).toMatch(/\p{Script=Han}/u);
    }
    expect(stepsFor("happy")[0].title).toBe("Owner offers the rental");
    expect(txLabel("Record pickup photo 1/2", "zh")).toBe("存证取车照片 1/2");
    expect(txLabel("Approve USDT", "en")).toBe("Approve USDT");
    for (const p of PROPERTIES) expect(propertyName(p.name, "zh")).toMatch(/\p{Script=Han}/u);
  });

  it("ELI5: same scenes, amounts and timing in both languages", () => {
    for (const e of ["happy", "disagree", "silent"] as const) {
      const a = story(e);
      const b = story(e, "zh");
      expect(b.map((s) => [s.id, s.duration, s.after])).toEqual(a.map((s) => [s.id, s.duration, s.after]));
      expect(b.map((s) => s.calendar?.length)).toEqual(a.map((s) => s.calendar?.length));
    }
  });

  it("friendly errors in Chinese, English by default", () => {
    expect(friendlyError(new Error("user rejected the request"))).toBe("You cancelled the request in your wallet.");
    expect(friendlyError(new Error("user rejected the request"), errorsIn("zh"))).toBe("你在钱包里取消了这次请求。");
    expect(friendlyError(42, errorsIn("zh"))).toBe("出了点问题。");
  });
});
