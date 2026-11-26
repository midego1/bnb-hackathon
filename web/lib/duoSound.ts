/**
 * /duo's sounds, synthesized with the Web Audio API (no files, no libraries), quiet (peaks around -12 dBFS) and tied
 * to the moments the vault animates: coins landing on the pile when the renter pays, a soft tick when a photo moves the
 * step bar on, a two-tone shimmer when the AI split colours the coins, the pile sliding out + the fee coin + a soft
 * chime at settlement, and a click on the presenter's buttons. A coin is a 2-3 ms click of high-passed noise (the hit)
 * and the ring of a small metal disc: inharmonic partials (1 : 2.76 : 5.40 : 8.93), the higher ones dying faster; each
 * coin differs a little (pitch, level, pan, timing). All of it goes through one compressor, so overlaps never clip.
 * The presenter turns them off with the speaker button or "M" (remembered here). scripts/duo-sounds.mjs renders them
 * to WAV files.
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

export function playSound(sound: Sound) {
  if (!soundOn() || !ctx || ctx.state !== "running") return;
  schedule(ctx, sound, ctx.currentTime + 0.02);
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * Where every sound goes: a compressor that holds overlapping coins under clipping, then a trim that takes back the
 * makeup gain every browser's compressor adds (+8 dB at these settings, scripts/duo-sounds.mjs), so quiet sounds pass
 * unchanged and a pile of coins peaks around -12 dBFS.
 */
const TRIM = 0.396;
const buses = new WeakMap<BaseAudioContext, AudioNode>();
function bus(c: BaseAudioContext) {
  let input = buses.get(c);
  if (!input) {
    const k = c.createDynamicsCompressor();
    k.threshold.value = -15;
    k.knee.value = 3;
    k.ratio.value = 20;
    k.attack.value = 0.001;
    k.release.value = 0.15;
    const trim = c.createGain();
    trim.gain.value = TRIM;
    k.connect(trim).connect(c.destination);
    buses.set(c, (input = k));
  }
  return input;
}

/** Half a second of white noise per context (looped, started at a random point, so no two hits are the same). */
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(c: BaseAudioContext) {
  let b = noises.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate / 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noises.set(c, b);
  }
  return b;
}

/** A gain that rises to `peak` in 1 ms at `at` and dies away exponentially, 60 dB down after `t60` s. */
function env(c: BaseAudioContext, at: number, peak: number, t60: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.001);
  g.gain.exponentialRampToValueAtTime(peak / 1000, at + t60);
  g.gain.linearRampToValueAtTime(0, at + t60 + 0.005);
  return g;
}

/** Filtered white noise with a fast decay: a coin's hit, a UI tick. */
function hit(c: BaseAudioContext, out: AudioNode, at: number, peak: number, t60: number, type: BiquadFilterType, freq: number, q = 0.7) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(env(c, at, peak, t60)).connect(out);
  src.start(at, rnd(0, 0.45));
  src.stop(at + t60 + 0.01);
}

/** A sine partial with the same fast decay (dropped above ~0.45 x the sample rate, where it would alias). */
function partial(c: BaseAudioContext, out: AudioNode, at: number, freq: number, peak: number, t60: number) {
  if (freq > c.sampleRate * 0.45) return;
  const o = c.createOscillator();
  o.frequency.value = freq;
  o.connect(env(c, at, peak, t60)).connect(out);
  o.start(at);
  o.stop(at + t60 + 0.01);
}

/** A small metal disc's modes: [ratio to the fundamental, level, ring time in s]. The higher ones die faster. */
const MODES = [
  [1, 1, 0.25],
  [2.76, 0.7, 0.15],
  [5.4, 0.5, 0.08],
  [8.93, 0.35, 0.045],
] as const;

/**
 * One coin landing: the hit (2-3 ms of noise high-passed at 3 kHz) and the ring, from a fundamental `f` (2.5-4.5 kHz)
 * that varies ±8 % per coin, with a slightly random level and place in the stereo field. `ring` stretches the ring.
 */
function coin(c: BaseAudioContext, out: AudioNode, at: number, peak: number, f: number, ring = 1) {
  const pan = c.createStereoPanner();
  pan.pan.value = rnd(-0.35, 0.35);
  pan.connect(out);
  const g = peak * rnd(0.75, 1);
  const f0 = f * rnd(0.92, 1.08);
  hit(c, pan, at, g * 0.6, rnd(0.002, 0.003), "highpass", 3000);
  for (const [ratio, level, t60] of MODES) partial(c, pan, at, f0 * ratio * rnd(0.99, 1.01), g * level * 0.45, t60 * ring * rnd(0.85, 1.15));
}

/** One voice: a sine (or `type`) at `freq` Hz from `at` s, a 5 ms attack to `peak` and an exponential decay over `dur` s. */
function tone(c: BaseAudioContext, out: AudioNode, at: number, freq: number, dur: number, peak: number, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Schedules `sound` on `c` from `t` s: the live AudioContext (playSound), or an OfflineAudioContext (scripts/duo-sounds.mjs). */
export function schedule(c: BaseAudioContext, sound: Sound, t: number) {
  const out = bus(c);
  switch (sound) {
    case "fill": {
      // The pile drops in over ~1.5 s (duo.css duo-coin-in): coins landing on coins, never on a beat; now and then one bounces.
      let at = t + 0.1;
      for (let k = 0; k < 15; k++) {
        coin(c, out, at, 0.25 - k * 0.005, 3400);
        if (Math.random() < 0.3) coin(c, out, at + rnd(0.03, 0.07), 0.08, 3400, 0.6);
        at += rnd(0.045, 0.15);
      }
      break;
    }
    case "tick": // a soft UI tick: a few ms of band-passed noise with a little body, no pitch to speak of
      hit(c, out, t, 0.36, 0.012, "bandpass", 2600, 1.2);
      partial(c, out, t, 1150, 0.03, 0.025);
      break;
    case "split": // two colours: teal (renter) then pink (owner), each with a slow detuned twin for the shimmer
      for (const [k, f] of [659.25, 987.77].entries()) {
        tone(c, out, t + k * 0.16, f, 0.9, 0.08, "triangle");
        tone(c, out, t + k * 0.16, f * 1.006, 0.9, 0.05);
      }
      break;
    case "settle": {
      // The pile slides out into both lanes (duo-out-l/r, ~1 s): a quick cascade, faster and lower as it goes.
      let at = t;
      for (let k = 0; k < 18; k++) {
        coin(c, out, at, 0.28 - k * 0.007, 3900 * (1 - k * 0.015), 0.7);
        at += rnd(0.03, 0.08) * (1 - k * 0.035);
      }
      coin(c, out, t + 2.15, 0.3, 3200, 2.6); // the fee coin lands (duo-out-fee, ~2.2 s): one clear clink, a little ring
      for (const [k, f] of [1046.5, 1318.51, 1567.98, 2093].entries()) tone(c, out, t + 2.55 + k * 0.11, f, 1.2, 0.05); // soft chime
      break;
    }
    case "click": // the presenter's buttons: a short, lower tick
      hit(c, out, t, 0.4, 0.008, "bandpass", 1700, 1.2);
      break;
  }
}
