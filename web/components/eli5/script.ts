import { deskRuling, newContext } from "@/lib/demo/script";
import { parseUnits } from "viem";
import { TOKEN } from "@/lib/contracts";
import { formatFiat, toFiat, type PriceResponse } from "@/lib/fiat";
import { localized, type Lang } from "@/lib/i18n/locales";
import { zhEli5 } from "./script.zh";

/**
 * Every word and number of the animated "explain it like I'm 5" page (/how-it-works) in one place.
 *
 * The money is the same as the one-click demo (/demo, lib/demo/script.ts): its first property at the demo's fallback
 * rate of 33 baht per dollar, the AI inspector's suggestion for the bundled move-out photos and the dispute desk's
 * scripted ruling. So the cartoon and the real run tell the same story with the same baht.
 *
 * The rented thing is a single variable (RENTAL below): switch it between the condo and a scooter in one place.
 * Chinese: script.zh.ts, by scene id (`story(ending, lang)`, `sceneText`, `endingsText`, `eli5Copy`).
 */

// ---------------------------------------------------------------------------------------------------------------
// The rented thing: switch it here.
// ---------------------------------------------------------------------------------------------------------------

export type RentalKind = "home" | "scooter";
export type Rental = {
  /** Which illustration to draw (components/eli5/Drawings.tsx). */
  kind: RentalKind;
  /** "the scooter", used in sentences. */
  the: string;
  emoji: string;
  owner: string;
  renter: string;
  /** Scene 1: how it usually goes without KeyScrow (max ~15 words). */
  usually: string;
  /** Scene 1's grown-up detail, given the deposit in baht. */
  usuallyDetail: (deposit: string) => string;
  /** What the robot spots on the last-day photo. */
  damage: string;
};

export const RENTALS: Record<RentalKind, Rental> = {
  home: {
    kind: "home",
    the: "the condo",
    emoji: "🏠",
    owner: "Landlord",
    renter: "Tenant",
    usually: "Usually you hand a big deposit to a stranger, and just hope it comes back.",
    usuallyDetail: (d) => `Without KeyScrow: a Bangkok deposit is two months' rent (${d}), paid straight to the landlord.`,
    damage: "a scuff on the wall",
  },
  scooter: {
    kind: "scooter",
    the: "the scooter",
    emoji: "🛵",
    owner: "Owner",
    renter: "Renter",
    usually: "Usually you leave your passport or a big deposit with a stranger, and hope.",
    usuallyDetail: (d) =>
      `Without KeyScrow: Thai rental shops hold your passport or a cash deposit (${d}), and decide alone what you get back.`,
    damage: "a scratch on the side",
  },
};

/** The one switch. */
export const RENTAL: Rental = RENTALS.scooter;

// ---------------------------------------------------------------------------------------------------------------
// Money: the /demo numbers, in token base units (TOKEN.decimals), shown in baht with a small dollar line.
// ---------------------------------------------------------------------------------------------------------------

/** The demo's fallback rate (lib/demo/script.ts newContext, lib/server/price MOCK_RATES): fixed, so this page works offline. */
export const THB_PER_USD = 33;
export const DEMO_PRICES: PriceResponse = {
  rates: { USDT: { THB: THB_PER_USD, USD: 1 }, BNB: { THB: 650 * THB_PER_USD, USD: 650 } },
  source: "mock",
  mock: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

/** One-time KeyScrow fee: 10% of one month's rent (EscrowFactory feeBps default 1000), taken from month 1. */
export const FEE_BPS = 1000;
/**
 * What the demo's AI inspector (the deterministic mock, lib/server/settlement/mock.ts) suggests the landlord keeps for
 * the bundled move-out photos: 39 tokens. tests/eli5-script.test.ts recomputes it from the photo files.
 */
export const AI_LANDLORD_CLAIM = parseUnits("39", TOKEN.decimals);

const ctx = newContext("happy", 0, THB_PER_USD);
ctx.inspection = { landlordClaim: AI_LANDLORD_CLAIM.toString() } as NonNullable<typeof ctx.inspection>;
const ruling = deskRuling(ctx);

export const MONEY = {
  rent: ctx.rent,
  deposit: ctx.deposit,
  paidIn: ctx.deposit + ctx.rent,
  termPeriods: ctx.termPeriods,
  fee: (ctx.rent * BigInt(FEE_BPS)) / BigInt(10_000),
  rentToLandlord: ctx.rent - (ctx.rent * BigInt(FEE_BPS)) / BigInt(10_000),
  aiLandlord: AI_LANDLORD_CLAIM,
  aiTenant: ctx.deposit - AI_LANDLORD_CLAIM,
  deskLandlord: ruling.landlordClaim,
  deskTenant: ruling.tenantRefund,
} as const;

export const baht = (v: bigint) => formatFiat(toFiat(v, "USDT", "THB", DEMO_PRICES) ?? 0, "THB");
export const dollars = (v: bigint) => formatFiat(toFiat(v, "USDT", "USD", DEMO_PRICES) ?? 0, "USD");

// ---------------------------------------------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------------------------------------------

export type Holder = "tenant" | "landlord" | "safe" | "jar";
export type Holdings = Record<Holder, bigint>;
export type Ending = "happy" | "disagree" | "silent";

/** Things on stage that switch on at a moment of a scene (ms from the scene start; 0 = there from the start). */
export type Cue =
  | "rental" // the rented thing, top centre
  | "worry" // tenant's "Will I get it back?" bubble
  | "grab" // the stranger pockets the deposit
  | "safe"
  | "locks"
  | "keys" // one key flies to each side
  | "agree" // the signed paper + AGREED stamp
  | "closed" // both locks click shut
  | "jar"
  | "calendar"
  | "photos"
  | "robot"
  | "scan" // the robot's magnifying glass sweeps the photos
  | "suggest" // the robot's suggestion bubble
  | "yes" // both say yes
  | "stamp" // AGREED stamp on the suggestion
  | "open" // both locks pop open
  | "no" // landlord says no
  | "referee"
  | "gavel"
  | "ruling"
  | "sleep" // landlord asleep, not answering
  | "days" // a 7-day countdown
  | "recap";

/** Coins flying from one holder to another, starting at `at` ms into the scene. */
export type Flow = { from: Holder; to: Holder; amount: bigint; at: number; coins: number };

export type SceneDef = {
  id: string;
  /** Big, child-simple: max ~15 words. */
  text: string;
  /** Small "grown-up detail": the real thing behind the picture. */
  detail: string;
  /** Reading time at normal speed, ms. */
  duration: number;
  cues: Partial<Record<Cue, number>>;
  flows?: Flow[];
  /** Start from these holdings instead of where the previous scene ended. */
  reset?: Holdings;
  /** Calendar label, when the calendar is on stage. */
  calendar?: string[];
  /** The robot's / referee's split, shown in their bubble: [to landlord, back to tenant]. */
  split?: [bigint, bigint];
};

export type Scene = SceneDef & { index: number; before: Holdings; after: Holdings };

const R = RENTAL;
/** Calendar pages for the rent scene: every month, or the first three, "…" and the last. */
const months = (n: number) => (n <= 4 ? Array.from({ length: n }, (_, i) => `Month ${i + 1}`) : ["Month 1", "Month 2", "Month 3", "…", `Month ${n}`]);
const owner = R.owner.toLowerCase();
const renter = R.renter.toLowerCase();
const START: Holdings = { tenant: MONEY.paidIn, landlord: BigInt(0), safe: BigInt(0), jar: BigInt(0) };

const shared: SceneDef[] = [
  {
    id: "problem",
    text: R.usually,
    detail: R.usuallyDetail(baht(MONEY.deposit)),
    duration: 8000,
    reset: { tenant: MONEY.deposit, landlord: BigInt(0), safe: BigInt(0), jar: BigInt(0) },
    cues: { rental: 0, grab: 2600, worry: 3800 },
    flows: [{ from: "tenant", to: "landlord", amount: MONEY.deposit, at: 900, coins: 6 }],
  },
  {
    id: "agree",
    text: `With KeyScrow, they agree on ${R.the}. A safe with two locks appears.`,
    detail: `EscrowFactory.createLease() makes a new RentalEscrow contract for this one rental on BNB Chain: ${baht(MONEY.rent)} a month, ${baht(MONEY.deposit)} deposit.`,
    duration: 8500,
    reset: START,
    cues: { rental: 0, agree: 700, safe: 2600, locks: 4000, keys: 5200 },
  },
  {
    id: "fund",
    text: `The ${renter} puts the deposit and the first month's rent in the safe.`,
    detail: `RentalEscrow.fund(): ${baht(MONEY.paidIn)} in MockUSDT (testnet USDT) moves into the contract, not to the ${owner}. Click: now nobody can take it alone.`,
    duration: 8000,
    cues: { rental: 0, safe: 0, locks: 0, keys: 0, closed: 4600 },
    flows: [{ from: "tenant", to: "safe", amount: MONEY.paidIn, at: 700, coins: 8 }],
  },
  {
    id: "rent",
    text: `Each month, rent rolls out to the ${owner}. A tiny coin goes in KeyScrow's jar, once.`,
    detail: `RentalEscrow.releaseRent(): month 1 pays ${baht(MONEY.rentToLandlord)} to the ${owner} and the one-time fee of ${baht(MONEY.fee)} (10% of one month) to the KeyScrow treasury. Later months: no fee.`,
    duration: 9000,
    cues: { rental: 0, safe: 0, locks: 0, keys: 0, closed: 0, jar: 400, calendar: 0 },
    calendar: months(MONEY.termPeriods),
    flows: [
      { from: "safe", to: "landlord", amount: MONEY.rentToLandlord, at: 1000, coins: 4 },
      { from: "safe", to: "jar", amount: MONEY.fee, at: 2600, coins: 1 },
    ],
  },
  {
    id: "moveout",
    text: "Moving-out day! Photos from the first day and the last day.",
    detail: "Check-in and check-out photos are stored off-chain; only their SHA-256 fingerprints go on the contract (addEvidence), so nobody can swap them later.",
    duration: 7500,
    cues: { safe: 0, locks: 0, keys: 0, closed: 0, jar: 0, photos: 600 },
  },
  {
    id: "inspect",
    text: "A robot compares the photos and suggests a fair split. It only suggests; people decide.",
    detail: `The KeyScrow Inspector AI agent (ERC-8004 identity) spots ${R.damage}: ${baht(MONEY.aiLandlord)} for repairs, ${baht(MONEY.aiTenant)} back. The ${renter} proposes it with propose().`,
    duration: 9000,
    cues: { safe: 0, locks: 0, keys: 0, closed: 0, jar: 0, photos: 0, robot: 300, scan: 1300, suggest: 4300 },
    split: [MONEY.aiLandlord, MONEY.aiTenant],
  },
];

const endings: Record<Ending, SceneDef> = {
  happy: {
    id: "happy",
    text: "Both say yes! Both keys turn, the safe opens, and everyone gets their coins.",
    detail: `RentalEscrow.accept(): one transaction pays ${baht(MONEY.aiTenant)} back to the ${renter} and ${baht(MONEY.aiLandlord)} to the ${owner}. No agent, no court.`,
    duration: 9000,
    cues: { safe: 0, locks: 0, keys: 0, closed: 0, jar: 0, photos: 0, robot: 0, suggest: 0, yes: 600, stamp: 2000, open: 3200 },
    split: [MONEY.aiLandlord, MONEY.aiTenant],
    flows: [
      { from: "safe", to: "tenant", amount: MONEY.aiTenant, at: 4000, coins: 6 },
      { from: "safe", to: "landlord", amount: MONEY.aiLandlord, at: 4400, coins: 2 },
    ],
  },
  disagree: {
    id: "disagree",
    text: `The ${owner} says no. A fair referee looks at the photos and decides the split.`,
    detail: `dispute() hands it to the KeyScrow dispute desk; resolve() pays ${baht(MONEY.deskLandlord)} for repairs and ${baht(MONEY.deskTenant)} back. If the desk misses 14 days, it all goes back to the ${renter}.`,
    duration: 10000,
    cues: { safe: 0, locks: 0, keys: 0, closed: 0, jar: 0, photos: 0, no: 500, referee: 1800, gavel: 3800, ruling: 4000, open: 4800 },
    split: [MONEY.deskLandlord, MONEY.deskTenant],
    flows: [
      { from: "safe", to: "tenant", amount: MONEY.deskTenant, at: 5600, coins: 6 },
      { from: "safe", to: "landlord", amount: MONEY.deskLandlord, at: 6000, coins: 3 },
    ],
  },
  silent: {
    id: "silent",
    text: `The ${owner} doesn't answer for 7 days. So the safe gives everything back to the ${renter}.`,
    detail: `After the 7-day reply window, anyone can call claimTimeout(): the full ${baht(MONEY.deposit)} deposit goes back to the ${renter}. Silence never costs the ${renter} money.`,
    duration: 10000,
    cues: { safe: 0, locks: 0, keys: 0, closed: 0, jar: 0, photos: 0, robot: 0, suggest: 0, sleep: 400, calendar: 900, days: 900, open: 5200 },
    calendar: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"],
    split: [MONEY.aiLandlord, MONEY.aiTenant],
    flows: [{ from: "safe", to: "tenant", amount: MONEY.deposit, at: 6000, coins: 7 }],
  },
};

const recap: SceneDef = {
  id: "recap",
  text: "Nobody can grab the money alone. The rules are code on BNB Chain.",
  detail: "Each rental gets its own RentalEscrow smart contract on BNB Chain. It holds no admin key: the money moves only by its rules.",
  duration: 9000,
  cues: { safe: 0, locks: 0, keys: 0, jar: 0, open: 0, recap: 300 },
};

/** The ending picker, in order. */
export const ENDINGS: { id: Ending; label: string; short: string }[] = [
  { id: "happy", label: "Both agree", short: "😊" },
  { id: "disagree", label: "They disagree", short: "⚖️" },
  { id: "silent", label: `${R.owner} goes silent`, short: "💤" },
];

const ZH = zhEli5(RENTAL.kind, MONEY, baht);
const SCENE_TEXT: Record<string, Pick<SceneDef, "text" | "detail" | "calendar">> = Object.fromEntries(
  [...shared, ...Object.values(endings), recap].map((d) => [d.id, { text: d.text, detail: d.detail, calendar: d.calendar }]),
);
/** Each scene's words by scene id, in a language. */
export const sceneText = localized(SCENE_TEXT, ZH.scenes);
/** The ending picker in a language. */
export const endingsText = localized(ENDINGS, ZH.endings);

/** Scenes for one ending, with what everyone holds before and after each scene. */
export function story(ending: Ending, lang: Lang = "en"): Scene[] {
  const text = sceneText(lang);
  const defs = [...shared, endings[ending], recap];
  const out: Scene[] = [];
  let h = START;
  defs.forEach((d, index) => {
    const before = d.reset ?? h;
    const after = { ...before };
    for (const f of d.flows ?? []) {
      after[f.from] -= f.amount;
      after[f.to] += f.amount;
    }
    out.push({ ...d, ...text[d.id], index, before, after });
    h = after;
  });
  return out;
}

export const totalDuration = (ending: Ending) => story(ending).reduce((s, x) => s + x.duration, 0);

/** What the recap card says each one ended with. */
export function recapLines(ending: Ending, lang: Lang = "en") {
  const end = story(ending).at(-1)!.after;
  const n = lang === "zh" ? ZH.recapNotes : ({ tenant: [R.renter, "got back"], landlord: [R.owner, "rent + repairs"], jar: ["KeyScrow jar", "one-time fee"], safe: ["The safe", "empty"] } as const);
  return (["tenant", "landlord", "jar", "safe"] as const).map((k) => ({ who: n[k][0], value: end[k], note: n[k][1] }));
}

// ---------------------------------------------------------------------------------------------------------------
// UI copy
// ---------------------------------------------------------------------------------------------------------------

export const copy = {
  pageTitle: "How it works",
  heading: "KeyScrow, explained simply",
  ending: "Ending",
  play: "Play",
  pause: "Pause",
  back: "Back",
  next: "Next",
  replay: "Watch again",
  sceneOf: (n: number, total: number) => `Scene ${n} of ${total}`,
  goTo: (n: number) => `Go to scene ${n}`,
  grownUp: "Grown-up detail",
  keys: "Space: play / pause · ← →: scenes",
  realDemo: "See it on a real chain →",
  tryIt: "Try it yourself →",
  recapTitle: "Who ended up with what",
  names: {
    tenant: R.renter,
    landlord: R.owner,
    safe: "The safe",
    jar: "KeyScrow jar",
    robot: "AI Inspector",
    referee: "Referee",
  },
  bubbles: {
    worry: "Will I get it back?",
    grab: "Thanks!",
    yes: "Yes!",
    no: "No!",
    sleep: "Zzz…",
    click: "click!",
    agreed: "AGREED",
    suggest: "I suggest:",
    rules: "I decide:",
    toLandlord: (v: string) => `${R.owner}: ${v}`,
    toTenant: (v: string) => `${R.renter}: ${v}`,
    before: "First day",
    after: "Last day",
    fair: "fair split",
    without: "Without KeyScrow",
    contract: "Rental",
  },
};

/** The page's UI copy in a language: `useT().of(eli5Copy)`. */
export const eli5Copy = localized(copy, ZH.ui);
