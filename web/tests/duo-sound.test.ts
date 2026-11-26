import { describe, expect, it } from "vitest";
import { playSound, soundFor, soundOn, unlockAudio, type Beat } from "@/lib/duoSound";

const at = (step: number, phase: Beat["phase"], slug = "honda-click-125i"): Beat => ({ slug, step, phase });

describe("duo sound: which sound for which transition", () => {
  it("one rental, start to end: fill, tick, tick, shimmer, settle", () => {
    const walk = [at(1, "none"), at(2, "funded"), at(3, "funded"), at(4, "funded"), at(4, "split"), at(5, "settled")];
    expect(walk.slice(1).map((next, k) => soundFor(walk[k], next))).toEqual(["fill", "tick", "tick", "split", "settle"]);
  });

  it("the first state seen (a load or reload) is silent, whatever it is", () => {
    for (const b of [at(1, "none"), at(2, "funded"), at(4, "split"), at(5, "settled")]) expect(soundFor(undefined, b)).toBeUndefined();
  });

  it("the same state again (a poll) is silent", () => {
    for (const b of [at(1, "none"), at(3, "funded"), at(4, "split"), at(5, "settled")]) expect(soundFor(b, { ...b })).toBeUndefined();
  });

  it("switching to another item is silent, even to a settled one", () => {
    expect(soundFor(at(1, "none"), at(5, "settled", "mystery-box"))).toBeUndefined();
    expect(soundFor(at(1, "none"), at(2, "funded", "mystery-box"))).toBeUndefined();
  });

  it("going back (reset, dispute, a new offer) is silent", () => {
    expect(soundFor(at(5, "settled"), at(1, "none"))).toBeUndefined();
    expect(soundFor(at(4, "split"), at(4, "funded"))).toBeUndefined(); // disputed
    expect(soundFor(at(3, "funded"), at(2, "funded"))).toBeUndefined();
  });

  it("step 5 before the chain index has the Settled event waits for the drain, then settles once", () => {
    expect(soundFor(at(4, "split"), at(5, "funded"))).toBeUndefined();
    expect(soundFor(at(5, "funded"), at(5, "settled"))).toBe("settle");
  });

  it("skipped polls still give the newest moment's sound", () => {
    expect(soundFor(at(1, "none"), at(3, "funded"))).toBe("fill"); // paid and pickup photo between two polls
    expect(soundFor(at(3, "funded"), at(4, "split"))).toBe("split");
    expect(soundFor(at(2, "funded"), at(5, "settled"))).toBe("settle");
  });

  it("without a browser (no AudioContext, no localStorage) nothing throws and nothing plays", () => {
    expect(soundOn()).toBe(true);
    expect(() => unlockAudio()).not.toThrow();
    expect(() => playSound("settle")).not.toThrow();
  });
});
