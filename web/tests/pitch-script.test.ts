import { describe, expect, it } from "vitest";
import { parsePitchStart, pitchReducer } from "@/components/pitch/Pitch";
import { BUDGET_S, mmss, PITCH_MONEY, SCENES } from "@/components/pitch/script";

const words = (s: string) => s.trim().split(/\s+/).length;
const total = (h: Record<string, bigint>) => Object.values(h).reduce((a, b) => a + b, BigInt(0));
const zero = BigInt(0);

describe("pitch script (/pitch)", () => {
  it("follows the 3-minute run sheet: time marks in order, scenes fill exactly 3:00, then the end card", () => {
    expect(SCENES.map((s) => mmss(s.at))).toEqual(["0:00", "0:20", "0:30", "0:45", "1:00", "1:20", "1:35", "1:50", "2:05", "2:20", "2:40", "3:00"]);
    const talk = SCENES.slice(0, -1).reduce((sum, s) => sum + s.duration, 0);
    expect(talk).toBe(BUDGET_S * 1000);
    expect(SCENES.at(-1)!.id).toBe("end");
  });

  it("every scene has one big sentence, a presenter note, and its cues and coins inside the scene", () => {
    for (const s of SCENES) {
      expect(words(s.text), `${s.id}: "${s.text}"`).toBeLessThanOrEqual(16);
      expect(s.note.length, s.id).toBeGreaterThan(20);
      for (const at of Object.values(s.cues)) expect(at, s.id).toBeLessThan(s.duration);
      for (const f of s.flashes ?? []) expect(f + 400, s.id).toBeLessThan(s.duration);
      for (const f of s.flows ?? []) expect(f.at + f.coins * 170 + 900, `${s.id} coins land in time`).toBeLessThan(s.duration);
    }
  });

  it("money is conserved, the safe holds rent + deposit while rented and is empty at the end", () => {
    const start = total(SCENES[0].before);
    for (const s of SCENES) expect(total(s.after), s.id).toBe(start);
    const at = (id: string) => SCENES.find((s) => s.id === id)!.after;
    expect(at("rent").safe).toBe(PITCH_MONEY.paidIn);
    expect(at("settle")).toEqual({ safe: zero, tenant: PITCH_MONEY.refund, landlord: PITCH_MONEY.toUs, jar: PITCH_MONEY.fee });
    expect(PITCH_MONEY.fee).toBe(PITCH_MONEY.rent / BigInt(10)); // 10% of one month's rent
    expect(SCENES.at(-1)!.after.safe).toBe(zero);
  });

  it("player: plays through every scene to the end and stops; space at the end starts over", () => {
    let s = { ...parsePitchStart("?speed=40"), playing: true };
    const seen = new Set<number>();
    for (let i = 0; i < 10_000 && !(s.index === SCENES.length - 1 && !s.playing); i++) {
      s = pitchReducer(s, { type: "tick", dt: 100 * s.speed });
      seen.add(s.index);
    }
    expect(seen.size).toBe(SCENES.length);
    expect(s.playing).toBe(false);
    expect(pitchReducer(s, { type: "toggle" })).toMatchObject({ index: 0, t: 0, playing: true });
  });

  it("query string: bad values keep the defaults", () => {
    expect(parsePitchStart("?scene=99&t=-5&speed=abc")).toEqual({ index: 0, t: 0, playing: true, speed: 1 });
    expect(parsePitchStart("?scene=3&t=999999&autoplay=0")).toMatchObject({ index: 2, t: SCENES[2].duration, playing: false });
  });
});
