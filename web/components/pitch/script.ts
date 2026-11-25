import { parseUnits } from "viem";
import { baht, FEE_BPS } from "@/components/eli5/script";
import { TOKEN } from "@/lib/contracts";
import type { Flow, Holdings } from "@/components/eli5/script";
import type { HeadKey, Key, T } from "@/lib/i18n/t";

/**
 * Every time mark and number of /pitch in one place (the words are in the dictionary, lib/i18n/dictionaries/en/more.ts
 * `pitch`, by scene id; sceneWords below): the animated storyboard of our 3-minute live pitch at
 * BNB Bangkok (a judge rents our physical Mystery Box live). For rehearsal, and as the backup slide if the live demo
 * fails. Each scene starts at its time mark and lasts until the next one, so at normal speed the page runs exactly
 * the 3:00 we have on stage.
 *
 * Holders reuse the /how-it-works stage positions: "landlord" is us (the box owner, left), "tenant" the judge (right).
 * Amounts are test USDT in token base units (TOKEN.decimals), shown in baht at the ELI5 demo rate.
 */

const usdt = (n: number) => parseUnits(String(n), TOKEN.decimals);

/** The Mystery Box rental, in test USDT. */
const rent = usdt(5);
const deposit = usdt(20);
const fee = (rent * BigInt(FEE_BPS)) / BigInt(10_000);
/** What the AI inspector proposes we keep from the deposit for the scuff on the returned box. */
const repair = usdt(4);
export const PITCH_MONEY = {
  rent,
  deposit,
  paidIn: rent + deposit,
  fee,
  repair,
  refund: deposit - repair,
  toUs: rent - fee + repair,
} as const;
const M = PITCH_MONEY;

/** The talk's time budget. */
export const BUDGET_S = 180;

export type PitchCue =
  | "scooter" // the problem: a scooter, top centre
  | "passport" // the tourist's passport flies to the shop
  | "grab" // the shop's "Thanks!"
  | "worry" // the tourist's thought bubble
  | "screen" // the big screen behind us
  | "safe"
  | "locks"
  | "closed" // both locks click shut
  | "box" // the Mystery Box on stage
  | "qr" // the QR code on the big screen
  | "phone" // the judge holds up a phone
  | "scan" // a beam from the phone to the QR
  | "bscscan" // the BscScan link flashes on the big screen
  | "pickup" // the box moves to the judge
  | "return" // the box moves back to us
  | "scuff" // the box has a scuff from now on
  | "robot"
  | "suggest"
  | "accept" // the pointer clicks Accept on the big screen
  | "open" // both locks pop open
  | "jar"
  | "chips"; // the screen's bullet chips appear one by one

export type PitchSceneId = "problem" | "oneliner" | "qr" | "wallet" | "rent" | "pickup" | "return" | "inspect" | "settle" | "native" | "business" | "end";

export type PitchSceneDef = {
  id: PitchSceneId;
  /** Time mark in seconds from the start of the talk. */
  at: number;
  cues: Partial<Record<PitchCue, number>>;
  /** The big screen is on, with this many lines under its title (dictionary pitch.scenes.<id>.line1..). */
  screen?: { lines: number };
  /** Camera flashes on the judge's phone, ms into the scene. */
  flashes?: number[];
  flows?: Flow[];
};

export type PitchScene = PitchSceneDef & { index: number; duration: number; before: Holdings; after: Holdings };

/** Only the last scene ("thank you") runs past the budget. */
const END_HOLD = 6000;

const defs: PitchSceneDef[] = [
  {
    id: "problem",
    at: 0,
    cues: { scooter: 0, passport: 1500, grab: 3200, worry: 5000 },
  },
  {
    id: "oneliner",
    at: 20,
    cues: { screen: 300, safe: 1500, locks: 3000 },
    screen: { lines: 2 },
  },
  {
    id: "qr",
    at: 30,
    cues: { screen: 0, safe: 0, locks: 0, box: 400, qr: 1200, phone: 4000, scan: 5500 },
    screen: { lines: 0 },
  },
  {
    id: "wallet",
    at: 45,
    cues: { screen: 0, safe: 0, locks: 0, box: 0, phone: 0 },
    screen: { lines: 2 },
    flows: [{ from: "landlord", to: "tenant", amount: M.paidIn, at: 1500, coins: 6 }],
  },
  {
    id: "rent",
    at: 60,
    cues: { screen: 0, safe: 0, locks: 0, box: 0, phone: 0, closed: 5000, bscscan: 7500 },
    screen: { lines: 2 },
    flows: [{ from: "tenant", to: "safe", amount: M.paidIn, at: 1500, coins: 8 }],
  },
  {
    id: "pickup",
    at: 80,
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, phone: 0, pickup: 600 },
    screen: { lines: 2 },
    flashes: [3500, 5500, 7500, 9500],
  },
  {
    id: "return",
    at: 95,
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, phone: 0, return: 600, scuff: 0 },
    screen: { lines: 2 },
    flashes: [3500, 5500, 7500, 9500],
  },
  {
    id: "inspect",
    at: 110,
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, scuff: 0, robot: 400, suggest: 3500 },
    screen: { lines: 2 },
  },
  {
    id: "settle",
    at: 125,
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, scuff: 0, robot: 0, suggest: 0, accept: 1500, open: 2600, jar: 3000 },
    screen: { lines: 0 },
    flows: [
      { from: "safe", to: "tenant", amount: M.refund, at: 4200, coins: 6 },
      { from: "safe", to: "landlord", amount: M.toUs, at: 4600, coins: 3 },
      { from: "safe", to: "jar", amount: M.fee, at: 5200, coins: 1 },
    ],
  },
  {
    id: "native",
    at: 140,
    cues: { screen: 0, safe: 0, locks: 0, open: 0, jar: 0, box: 0, scuff: 0, chips: 1500 },
    screen: { lines: 3 },
  },
  {
    id: "business",
    at: 160,
    cues: { screen: 0, safe: 0, locks: 0, open: 0, jar: 0, box: 0, scuff: 0, chips: 1500 },
    screen: { lines: 3 },
  },
  {
    id: "end",
    at: BUDGET_S,
    cues: { screen: 0, safe: 0, locks: 0, open: 0, jar: 0, box: 0, scuff: 0 },
    screen: { lines: 1 },
  },
];

/** Us: the faucet that fills the judge's guest wallet, and the box owner. */
const START: Holdings = { landlord: M.paidIn, tenant: BigInt(0), safe: BigInt(0), jar: BigInt(0) };

export const SCENES: PitchScene[] = (() => {
  let h = START;
  return defs.map((d, index) => {
    const before = h;
    const after = { ...before };
    for (const f of d.flows ?? []) {
      after[f.from] -= f.amount;
      after[f.to] += f.amount;
    }
    h = after;
    const next = defs[index + 1];
    return { ...d, index, before, after, duration: next ? (next.at - d.at) * 1000 : END_HOLD };
  });
})();

/** "2:05" */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * A scene's words in the visitor's language: the one big sentence for the audience (a headline: bilingual in EN+中文),
 * what the presenter says or clicks, and what the big screen shows.
 */
export function sceneWords(t: T, s: PitchSceneDef) {
  const k = `pitch.scenes.${s.id}` as const;
  const vars = { paidIn: baht(M.paidIn), deposit: baht(M.deposit), rent: baht(M.rent) };
  return {
    text: t.h(k satisfies HeadKey),
    note: t(`${k}.note` satisfies Key),
    title: s.screen ? t(`${k}.title` as Key) : "",
    lines: Array.from({ length: s.screen?.lines ?? 0 }, (_, i) => t(`${k}.line${i + 1}` as Key, vars)),
  };
}
