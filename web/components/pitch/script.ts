import { baht, FEE_BPS } from "@/components/eli5/script";
import type { Flow, Holdings } from "@/components/eli5/script";

/**
 * Every word, time mark and number of /pitch in one place: the animated storyboard of our 3-minute live pitch at
 * BNB Bangkok (a judge rents our physical Mystery Box live). For rehearsal, and as the backup slide if the live demo
 * fails. Each scene starts at its time mark and lasts until the next one, so at normal speed the page runs exactly
 * the 3:00 we have on stage.
 *
 * Holders reuse the /how-it-works stage positions: "landlord" is us (the box owner, left), "tenant" the judge (right).
 * Amounts are test USDT in 6-decimal base units, shown in baht at the ELI5 demo rate.
 */

const usdt = (n: number) => BigInt(Math.round(n * 1_000_000));

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

export type PitchSceneDef = {
  id: string;
  /** Time mark in seconds from the start of the talk. */
  at: number;
  /** One big sentence for the audience. */
  text: string;
  /** What the presenter says or clicks. */
  note: string;
  cues: Partial<Record<PitchCue, number>>;
  /** What the big screen shows. */
  screen?: { title: string; lines?: string[] };
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
    text: "Rent a scooter in Thailand, and the shop keeps your passport as the deposit.",
    note: "Say: at return the shop alone decides what every scratch costs. Owners have no proof either.",
    cues: { scooter: 0, passport: 1500, grab: 3200, worry: 5000 },
  },
  {
    id: "oneliner",
    at: 20,
    text: "KeyEscrow puts every deposit in its own safe with two locks, on BNB Chain.",
    note: "Say: one small escrow contract per rental. Neither side can empty it alone.",
    cues: { screen: 300, safe: 1500, locks: 3000 },
    screen: { title: "KeyEscrow", lines: ["One escrow contract per rental", "Neither side can empty it alone"] },
  },
  {
    id: "qr",
    at: 30,
    text: "Who wants to rent our Mystery Box? Scan the QR on the big screen.",
    note: "Hold up the box. Pick a volunteer judge; they scan the QR with their phone.",
    cues: { screen: 0, safe: 0, locks: 0, box: 400, qr: 1200, phone: 4000, scan: 5500 },
    screen: { title: "Rent our Mystery Box" },
  },
  {
    id: "wallet",
    at: 45,
    text: "The judge's phone gets a guest wallet with test money. No app, no seed phrase.",
    note: "Say: a throwaway wallet on BSC testnet, filled by our faucet. Wait for the green check.",
    cues: { screen: 0, safe: 0, locks: 0, box: 0, phone: 0 },
    screen: { title: "Guest wallet ready ✓", lines: [`${baht(M.paidIn)} in test USDT`, "BSC testnet"] },
    flows: [{ from: "landlord", to: "tenant", amount: M.paidIn, at: 1500, coins: 6 }],
  },
  {
    id: "rent",
    at: 60,
    text: "The judge rents the box: deposit and rent go into the box's own safe.",
    note: "Judge taps Rent. Click the BscScan link on the big screen: a new contract, live.",
    cues: { screen: 0, safe: 0, locks: 0, box: 0, phone: 0, closed: 5000, bscscan: 7500 },
    screen: { title: "Rental funded", lines: [`${baht(M.deposit)} deposit + ${baht(M.rent)} rent`, "in this rental's own escrow"] },
    flows: [{ from: "tenant", to: "safe", amount: M.paidIn, at: 1500, coins: 8 }],
  },
  {
    id: "pickup",
    at: 80,
    text: "Pickup: the judge photographs the box from every side.",
    note: "Say: live camera only, time and place stamped. Only SHA-256 fingerprints go on-chain.",
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, phone: 0, pickup: 600 },
    screen: { title: "Pickup photos", lines: ["4 sides, live camera only", "Fingerprints on BNB Chain"] },
    flashes: [3500, 5500, 7500, 9500],
  },
  {
    id: "return",
    at: 95,
    text: "The judge hands the box back and takes the return photos.",
    note: "Take the box back on stage. Say: same angles as pickup, so they can be compared.",
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, phone: 0, return: 600, scuff: 0 },
    screen: { title: "Return photos", lines: ["Same 4 sides", "Fingerprints on BNB Chain"] },
    flashes: [3500, 5500, 7500, 9500],
  },
  {
    id: "inspect",
    at: 110,
    text: "Our AI inspector compares the photos and proposes a split. People decide.",
    note: "Say: an on-chain agent with an ERC-8004 identity. It drafts, it never decides.",
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, scuff: 0, robot: 400, suggest: 3500 },
    screen: { title: "AI inspector", lines: ["Found: a scuff on one side", "Proposal, not a verdict"] },
  },
  {
    id: "settle",
    at: 125,
    text: "We accept on the big screen: both locks open and the money settles.",
    note: "Click Accept on the big screen. Say: one transaction pays everyone.",
    cues: { screen: 0, safe: 0, locks: 0, closed: 0, box: 0, scuff: 0, robot: 0, suggest: 0, accept: 1500, open: 2600, jar: 3000 },
    screen: { title: "Accept the split?" },
    flows: [
      { from: "safe", to: "tenant", amount: M.refund, at: 4200, coins: 6 },
      { from: "safe", to: "landlord", amount: M.toUs, at: 4600, coins: 3 },
      { from: "safe", to: "jar", amount: M.fee, at: 5200, coins: 1 },
    ],
  },
  {
    id: "native",
    at: 140,
    text: "The safe is empty, everyone got their share, and it is all native to BNB Chain.",
    note: "Say: ERC-8004 inspector agent, one escrow per rental, opBNB about 90x cheaper for payouts.",
    cues: { screen: 0, safe: 0, locks: 0, open: 0, jar: 0, box: 0, scuff: 0, chips: 1500 },
    screen: { title: "BNB-native", lines: ["ERC-8004 AI agent", "One escrow per rental", "opBNB: ~90x cheaper"] },
  },
  {
    id: "business",
    at: 160,
    text: "We earn 10% of one month's rent per rental. Help us pilot with real shops.",
    note: "Say: fee once per rental, plus the dispute desk as a service. Ask: intros to shops in Chiang Mai and Phuket.",
    cues: { screen: 0, safe: 0, locks: 0, open: 0, jar: 0, box: 0, scuff: 0, chips: 1500 },
    screen: { title: "Business model", lines: ["10% of one month's rent, once", "Dispute desk as a service", "Ask: pilot shops in Chiang Mai + Phuket"] },
  },
  {
    id: "end",
    at: BUDGET_S,
    text: "Keep your passport. KeyEscrow.",
    note: "Stop. Thank the judge, hand them the box, take questions.",
    cues: { screen: 0, safe: 0, locks: 0, open: 0, jar: 0, box: 0, scuff: 0 },
    screen: { title: "Keep your passport.", lines: ["KeyEscrow · live on BSC testnet"] },
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

export const pitchCopy = {
  pageTitle: "How we pitch",
  heading: "How we pitch",
  sub: "3-minute live pitch, BNB Bangkok",
  play: "Play",
  pause: "Pause",
  back: "Back",
  next: "Next",
  replay: "Again",
  sceneOf: (n: number, total: number) => `Scene ${n} of ${total}`,
  goTo: (n: number, mark: string) => `Go to scene ${n} (${mark})`,
  keys: "Space: play / pause · ← →: scenes",
  budget: "Time budget",
  names: { landlord: "Us · box owner", tenant: "Judge", safe: "The box's safe", jar: "KeyEscrow jar", shop: "Rental shop", tourist: "Tourist", robot: "AI inspector" },
  bubbles: {
    grab: "Thanks!",
    worry: "My passport…",
    passport: "PASSPORT",
    scan: "Scan me",
    box: "?",
    bscscan: "View on BscScan ↗",
    suggest: "I propose:",
    toUs: (v: string) => `Us: ${v}`,
    toJudge: (v: string) => `Judge: ${v}`,
    accept: "Accept",
    wallet: "Guest wallet",
    photos: (n: number) => `${n}/4`,
    click: "click!",
    accepted: "Accepted ✓",
    empty: "empty",
  },
};
