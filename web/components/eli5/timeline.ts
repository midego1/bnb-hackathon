import type { Cue, Holder, Holdings, Scene } from "./script";

/**
 * The animation is a pure function of (scene, t): t is the scene clock in ms at normal speed. The player only
 * advances t, so pause freezes everything mid-flight and any scene can be jumped to or screenshotted at any moment.
 */

export const COIN_FLIGHT = 900;
export const COIN_STAGGER = 170;
export const ENTER = 450;

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
export const easeOutBack = (p: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
};

/** 0 before the cue, rising to 1 over `span` ms after it. A cue at 0 is there from the start (already 1). */
export function cue<C extends string = Cue>(scene: { cues: Partial<Record<C, number>> }, name: C, t: number, span = ENTER): number {
  const at = scene.cues[name];
  if (at === undefined) return 0;
  if (at === 0) return 1;
  return clamp01((t - at) / span);
}
export const has = <C extends string = Cue>(scene: { cues: Partial<Record<C, number>> }, name: C) => scene.cues[name] !== undefined;

/** Where each holder's coins leave from and land, in stage units (viewBox 1200 x 560). */
export const ANCHORS: Record<Holder, { x: number; y: number }> = {
  landlord: { x: 205, y: 395 },
  tenant: { x: 995, y: 395 },
  safe: { x: 600, y: 370 },
  jar: { x: 370, y: 410 },
};

export type FlyingCoin = { key: string; x: number; y: number; opacity: number; r: number };

/** Coins in the air at t. Reduced motion: each coin fades out at the start and fades in at the end, no travel. */
export function coinsAt(scene: Pick<Scene, "flows">, t: number, reduced: boolean): FlyingCoin[] {
  const out: FlyingCoin[] = [];
  (scene.flows ?? []).forEach((f, fi) => {
    const a = ANCHORS[f.from];
    const b = ANCHORS[f.to];
    const r = f.to === "jar" || f.from === "jar" ? 11 : 16;
    for (let i = 0; i < f.coins; i++) {
      const p = (t - f.at - i * COIN_STAGGER) / COIN_FLIGHT;
      if (p <= 0 || p >= 1) continue;
      const key = `${fi}-${i}`;
      if (reduced) {
        const at = p < 0.5 ? a : b;
        out.push({ key, x: at.x, y: at.y, r, opacity: p < 0.5 ? 1 - p * 2 : p * 2 - 1 });
        continue;
      }
      const e = easeInOut(p);
      const lift = Math.min(180, 60 + Math.abs(b.x - a.x) * 0.35);
      const cx = (a.x + b.x) / 2;
      const cy = Math.min(a.y, b.y) - lift;
      const x = (1 - e) ** 2 * a.x + 2 * (1 - e) * e * cx + e ** 2 * b.x;
      const y = (1 - e) ** 2 * a.y + 2 * (1 - e) * e * cy + e ** 2 * b.y;
      out.push({ key, x, y, r, opacity: 1 });
    }
  });
  return out;
}

/** What everyone holds at t: a holder pays a coin's share when it leaves and receives it when it lands. */
export function holdingsAt(scene: Pick<Scene, "flows" | "before">, t: number): Holdings {
  const h = { ...scene.before };
  for (const f of scene.flows ?? []) {
    let left = 0;
    let landed = 0;
    for (let i = 0; i < f.coins; i++) {
      const start = f.at + i * COIN_STAGGER;
      if (t > start) left++;
      if (t >= start + COIN_FLIGHT) landed++;
    }
    const share = (n: number) => (n === f.coins ? f.amount : (f.amount * BigInt(n)) / BigInt(f.coins));
    h[f.from] -= share(left);
    h[f.to] += share(landed);
  }
  return h;
}

/** Index into a cycling label list (calendar pages) between the cue and `until` ms. */
export function pageAt(labels: string[], t: number, from: number, until: number): number {
  if (t <= from) return 0;
  return Math.min(labels.length - 1, Math.floor(((t - from) / Math.max(1, until - from)) * labels.length));
}
