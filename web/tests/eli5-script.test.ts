import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_LANDLORD_CLAIM, baht, ENDINGS, MONEY, RENTAL, RENTALS, story, totalDuration, type Ending } from "@/components/eli5/script";
import { ANCHORS, coinsAt, holdingsAt } from "@/components/eli5/timeline";
import { newContext, PROPERTIES } from "@/lib/demo/script";
import { formatFiat } from "@/lib/fiat";
import { mockAssessment } from "@/lib/server/settlement/mock";

const endings = ENDINGS.map((e) => e.id);
const words = (s: string) => s.trim().split(/\s+/).length;
const zero = BigInt(0);

describe("ELI5 script (/how-it-works)", () => {
  it("every scene of every ending has short narration, a grown-up detail and reading time", () => {
    for (const e of endings) {
      for (const s of story(e)) {
        expect(s.text.length, `${e}/${s.id}`).toBeGreaterThan(10);
        expect(words(s.text), `${e}/${s.id}: "${s.text}"`).toBeLessThanOrEqual(16);
        expect(s.detail.length, `${e}/${s.id}`).toBeGreaterThan(20);
        expect(s.duration, `${e}/${s.id}`).toBeGreaterThanOrEqual(6000);
        expect(s.duration, `${e}/${s.id}`).toBeLessThanOrEqual(11000);
        for (const at of Object.values(s.cues)) expect(at).toBeLessThan(s.duration);
        for (const f of s.flows ?? []) expect(f.at + 2000, `${e}/${s.id} coins land before the scene ends`).toBeLessThan(s.duration);
      }
    }
  });

  it("each ending is complete: same opening, its own ending scene, then the recap, in 60-90 s", () => {
    const ids = (e: Ending) => story(e).map((s) => s.id);
    expect(ids("happy")).toEqual(["problem", "agree", "fund", "rent", "moveout", "inspect", "happy", "recap"]);
    expect(ids("disagree").slice(-2)).toEqual(["disagree", "recap"]);
    expect(ids("silent").slice(-2)).toEqual(["silent", "recap"]);
    expect(ids("disagree").slice(0, 6)).toEqual(ids("happy").slice(0, 6));
    for (const e of endings) {
      expect(totalDuration(e)).toBeGreaterThanOrEqual(60_000);
      expect(totalDuration(e)).toBeLessThanOrEqual(90_000);
    }
  });

  it("the money adds up: nobody goes negative, the safe ends empty, every baht paid in is accounted for", () => {
    const expected: Record<Ending, { tenant: bigint; landlord: bigint }> = {
      happy: { tenant: MONEY.aiTenant, landlord: MONEY.rentToLandlord + MONEY.aiLandlord },
      disagree: { tenant: MONEY.deskTenant, landlord: MONEY.rentToLandlord + MONEY.deskLandlord },
      silent: { tenant: MONEY.deposit, landlord: MONEY.rentToLandlord },
    };
    for (const e of endings) {
      const scenes = story(e);
      for (const s of scenes) for (const v of [...Object.values(s.before), ...Object.values(s.after)]) expect(v >= zero, `${e}/${s.id}`).toBe(true);
      const end = scenes.at(-1)!.after;
      expect(end.safe).toBe(zero);
      expect(end.jar).toBe(MONEY.fee);
      expect(end).toMatchObject(expected[e]);
      expect(end.tenant + end.landlord + end.jar).toBe(MONEY.paidIn);
    }
  });

  it("tells the same story as /demo: its first property in baht, a 10% one-time fee, the desk's ruling", () => {
    const demo = newContext("happy", 0, 33);
    expect(MONEY.rent).toBe(demo.rent);
    expect(MONEY.deposit).toBe(demo.deposit);
    const thb = (n: number) => formatFiat(n, "THB");
    expect(baht(MONEY.rent)).toBe(thb(PROPERTIES[0].rentThb));
    expect(baht(MONEY.deposit)).toBe(thb(PROPERTIES[0].rentThb * 2));
    expect(baht(MONEY.fee)).toBe(thb(PROPERTIES[0].rentThb / 10));
    // 1.5x the AI estimate in whole mUSDT (lib/demo/script deskRuling).
    expect(MONEY.deskLandlord).toBe(((AI_LANDLORD_CLAIM * BigInt(3)) / BigInt(2) / BigInt(1_000_000)) * BigInt(1_000_000));
  });

  it("the AI suggestion is what the demo's inspector says about the bundled move-out photos", () => {
    // The photo sets, in the order lib/demo/script.ts uploads them (CHECK_IN / CHECK_OUT).
    const source = readFileSync(path.resolve(__dirname, "../lib/demo/script.ts"), "utf8");
    const files = (kind: string) => [...source.matchAll(new RegExp(`file: "(${kind}-[^"]+)"`, "g"))].map((m) => m[1]);
    expect(files("checkin").length).toBeGreaterThan(0);
    const dir = path.resolve(__dirname, "../public/demo/walkthrough");
    const photo = (file: string) => ({ hash: `0x${createHash("sha256").update(readFileSync(path.join(dir, file))).digest("hex")}` });
    const raw = mockAssessment({
      deposit: MONEY.deposit.toString(),
      decimals: 6,
      currency: "USDT",
      checkIn: files("checkin").map(photo),
      checkOut: files("checkout").map(photo),
    } as Parameters<typeof mockAssessment>[0]);
    expect(BigInt(Math.round(Number(raw.landlordClaim) * 1e6))).toBe(AI_LANDLORD_CLAIM);
  });

  it("the rented thing comes from one variable, and both rentals are fully described", () => {
    expect(story("happy").map((s) => s.text).join(" ")).toContain(RENTAL.the);
    for (const r of Object.values(RENTALS)) for (const v of Object.values(r)) expect(String(v).length).toBeGreaterThan(0);
  });

  it("timeline: holdings move coin by coin from `before` to `after`; reduced motion fades in place", () => {
    for (const s of story("disagree")) {
      expect(holdingsAt(s, 0)).toEqual(s.before);
      expect(holdingsAt(s, s.duration)).toEqual(s.after);
    }
    const fund = story("happy").find((s) => s.id === "fund")!;
    const mid = fund.flows![0].at + 400;
    const flying = coinsAt(fund, mid, false);
    expect(flying.length).toBeGreaterThan(0);
    expect(flying.some((c) => c.x !== ANCHORS.tenant.x && c.x !== ANCHORS.safe.x)).toBe(true);
    for (const c of coinsAt(fund, mid, true)) expect([ANCHORS.tenant.x, ANCHORS.safe.x]).toContain(c.x);
  });
});
