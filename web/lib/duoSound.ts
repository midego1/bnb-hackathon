/**
 * /duo's sounds, synthesized with the Web Audio API (no files, no libraries), quiet (peaks around -12 dBFS) and tied
 * to the moments the vault animates: coins dropping in when the renter pays, a tick when a photo moves the step bar on,
 * a two-tone shimmer when the AI split colours the coins, a drain + fee "ding" + chime at settlement, and a click on
 * the presenter's buttons. The presenter turns them off with the bar's speaker button or "M" (remembered here).
 */
import type { VaultPhase } from "@/lib/stage";

export type Sound = "fill" | "tick" | "split" | "settle" | "click";
/** What the screen shows of one item's rental: its step (lib/stage duoStep) and the vault's phase (vaultPhase). */
export type Beat = { slug: string; step: number; phase: VaultPhase };

/**
 * The sound for a change on screen, or none. Pure: tests/duo-sound.test.ts. Only forward moves of the same item make a
 * sound; the first state seen (a load or reload) and a switch to another item stay silent, so nothing replays.
 */
export function soundFor(prev: Beat | undefined, next: Beat): Sound | undefined {
  if (!prev || prev.slug !== next.slug || (prev.phase === next.phase && prev.step === next.step)) return undefined;
  if (next.phase === "settled") return prev.phase === "settled" ? undefined : "settle";
  if (next.phase === "split") return prev.phase === "funded" || prev.phase === "none" ? "split" : undefined;
  if (next.phase === "funded" && prev.phase === "none") return "fill";
  // A photo anchored (2 -> 3, 3 -> 4). Step 5 without the drain is the chain index catching up: wait for "settle".
  return next.phase === prev.phase && next.step > prev.step && next.step < 5 ? "tick" : undefined;
}

const KEY = "ke_duo_sound";
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribeSound = (f: () => void) => (subs.add(f), () => void subs.delete(f));

let on: boolean | undefined;
/** Sound on (the default) or off, as the presenter left it. */
export function soundOn(): boolean {
  if (on === undefined) {
    try {
      on = localStorage.getItem(KEY) !== "off";
    } catch {
      on = true;
    }
  }
  return on;
}
export function setSoundOn(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? "on" : "off");
  } catch {}
  emit();
}

let ctx: AudioContext | undefined;
/** Browsers let audio start only after a click, tap or key: call this from one (created there, never before). */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      ctx.onstatechange = emit;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {}
}
export const audioReady = () => ctx?.state === "running";

/** One voice: a sine (or `type`) at `freq` Hz from `at` s, a 5 ms attack to `peak` and an exponential decay over `dur` s. */
function tone(c: AudioContext, at: number, freq: number, dur: number, peak: number, type: OscillatorType = "sine", glide?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A small coin: a bright partial and an inharmonic one above it (the metal), short. */
const coin = (c: AudioContext, at: number, freq: number, peak: number) => {
  tone(c, at, freq, 0.14, peak);
  tone(c, at, freq * 2.76, 0.08, peak / 2);
};

/** Pitches the coins step through (a fixed walk, not random, so every run sounds the same). */
const WALK = [0, 3, 1, 4, 2, 5, 1, 3];

export function playSound(sound: Sound) {
  if (!soundOn() || !ctx || ctx.state !== "running") return;
  const c = ctx;
  const t = c.currentTime + 0.02;
  switch (sound) {
    case "fill": // the pile drops in over ~1.4 s (duo.css duo-coin-in): coins, lower and softer as it fills
      for (let k = 0; k < 14; k++) coin(c, t + k * 0.1, 2400 - k * 50 + WALK[k % 8] * 60, 0.12 - k * 0.005);
      break;
    case "tick":
      tone(c, t, 1320, 0.07, 0.12, "triangle");
      break;
    case "split": // two colours: teal (renter) then pink (owner), each with a slow detuned twin for the shimmer
      for (const [k, f] of [659.25, 987.77].entries()) {
        tone(c, t + k * 0.16, f, 0.9, 0.08, "triangle");
        tone(c, t + k * 0.16, f * 1.006, 0.9, 0.05);
      }
      break;
    case "settle": // the pile drains (duo-out-l/r, ~1 s), the fee coin lands (duo-out-fee, ends ~2.3 s), then a chime
      for (let k = 0; k < 10; k++) coin(c, t + k * 0.09, 2200 - k * 90 + WALK[k % 8] * 40, 0.1 - k * 0.006);
      tone(c, t + 2.1, 1567.98, 0.6, 0.12);
      for (const [k, f] of [1046.5, 1318.51, 1567.98, 2093].entries()) tone(c, t + 2.5 + k * 0.11, f, 1.2, 0.07);
      break;
    case "click":
      tone(c, t, 1800, 0.03, 0.08, "sine", 900);
      break;
  }
}
