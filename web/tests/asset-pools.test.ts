import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

/** The Shareholders "Coming soon: Asset pools" card: roadmap copy only (no coin, no ticker, no token sale). */
describe("asset pools card copy", () => {
  const RULES = ["refund", "cap", "kyc", "fixed", "income"];

  it("has the five rules, the example label and the waitlist reason in both languages", () => {
    // zh is a partial dictionary (English fills gaps); here every card key must be translated.
    for (const p of [en.holders.pools, zh.holders!.pools!]) {
      expect(Object.keys(p.rules ?? {})).toEqual(RULES);
      for (const k of ["soon", "intro", "example", "asset", "target", "filled", "whyNot", "legal", "join", "joinReason"] as const) expect(p[k]).toBeTruthy();
      expect(p.target).toContain("{amount}");
      expect(p.filled).toContain("{pct}");
    }
    expect(en.headlines.holders.pools).toMatch(/^Coming soon/);
    expect(zh.headlines!.holders!.pools).not.toBe(en.headlines.holders.pools);
  });

  it("stays honest: an example, a refund, the 10 % cap, no coin and no ticker", () => {
    const p = en.holders.pools;
    expect(p.filled).toMatch(/example/i);
    expect(p.intro).toMatch(/No coin, no token sale/);
    expect(p.rules.refund).toMatch(/full automatic refund/);
    expect(p.rules.cap).toMatch(/10 %.*every purchase and every transfer/);
    expect(p.rules.fixed).toMatch(/no team allocation, no extra minting/i);
    expect(JSON.stringify([en.holders.pools, zh.holders!.pools])).not.toMatch(/\$[A-Z]{2,}|-POOL|ticker/i);
  });
});
