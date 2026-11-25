import type { DemoActor, DemoPath } from "@/lib/demo/script";
import { localized } from "@/lib/i18n/locales";
import { zh } from "./copy.zh";

/**
 * Every user-facing string of the /demo stage UI in one place (the step narration itself lives with the steps in
 * lib/demo/script.ts). Layout components read it through `demoCopy` (English, or Chinese from copy.zh.ts) and hold
 * no copy of their own.
 */

const pageTitle = "Play the demo";
const pageIntro =
  "One click plays the whole KeyEscrow story on the local chain: real contracts, real transactions, and the real rental page updating live underneath. The demo accounts switch by themselves.";

const actorLabel: Record<DemoActor, string> = {
  landlord: "Owner",
  tenant: "Renter",
  arbiter: "Dispute desk",
  inspector: "KeyEscrow Inspector (AI agent)",
  investor: "Shareholder",
  anyone: "Anyone",
};

/** The actor cards on the left of the stage. */
const actorCards = {
  landlord: { name: "Owner", note: "Offers the rental, gets the rent" },
  tenant: { name: "Renter", note: "Pays deposit + rent into escrow" },
  escrow: { name: "Escrow contract", note: "This rental only: holds the deposit", empty: "Created in step 1" },
  treasury: { name: "KeyEscrow treasury", note: "Platform fee: one-time, from month 1" },
  arbiter: { name: "Dispute desk", note: "Rules on disputes. Holds no money." },
  inspector: { name: "AI Inspector", note: "Drafts the split. Holds no money." },
  faucet: "MockUSDT faucet",
} as const;

const controls = {
  story: "Story",
  speed: "Speed",
  mode: "Mode",
  normal: "Normal",
  fast: "Fast",
  auto: "Autoplay",
  step: "Step by step",
  play: "Play the demo",
  playAgain: "Play again",
  next: "Next step →",
  pause: "❚❚ Pause",
  resume: "▶ Resume",
  restart: "Restart",
  connecting: "Connecting to the local chain…",
  paused: "Paused. Press Resume to continue.",
  pausing: "Pausing before the next transaction…",
  showSummary: "Show the summary",
};

const intro = {
  title: "What you are about to see",
  bullets: [
    "A fresh scooter rental, created, funded and settled with real transactions on this local anvil chain.",
    "The demo switches between the owner, renter and dispute desk accounts for you (watch the yellow bar).",
    "Every amount in baht first, then dollars and the exact mUSDT on-chain.",
    "The AI return inspection, the KeyEscrow fee going to the treasury, and the final balances.",
  ],
  presenting: "Presenting live? Pick Step by step: each step waits for your click. Pause works any time.",
};

const panels = {
  story: "The story",
  stage: "Current step",
  live: "The real rental page, live",
  liveNote: "The same component owner and renter use, re-rendered after every transaction.",
  liveEmpty: "The rental page appears here as soon as the owner has created the rental.",
  openTab: "Open in its own tab ↗",
  moved: "Money moved",
  nothingMoved: "No money moved in this step.",
  working: "working…",
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  txTitle: (hash: string) => `Transaction ${hash}: see it on the rental timeline`,
};

const errorCopy = {
  title: (n: number, title?: string) => `Step ${n} (${title}) did not work`,
  retry: "Retry this step",
  startOver: "Start over with a fresh rental",
};

const inspectionCopy = {
  title: "AI return inspection",
  back: "Back to renter",
  keeps: "Owner keeps (repairs)",
  signed: (name: string, agentId?: string | number) =>
    `Signed by ${name}${agentId !== undefined ? `, ERC-8004 agent #${agentId}` : ""}: its identity is registered on BNB Chain, so anyone can check this report came from it.`,
  unsigned:
    "Report by the KeyEscrow Inspector agent. Unsigned on this local demo (no INSPECTOR_PRIVATE_KEY set); with its key set, every report is signed by the agent's ERC-8004 identity on BNB Chain.",
  meta: (confidence: number, mock: boolean, provider: string) =>
    `Confidence ${(confidence * 100).toFixed(0)}% · ${mock ? "demo inspector (no AI key configured)" : `vision model: ${provider}`} · report`,
};

const summaryCopy = {
  tryLabel: {
    happy: "Try the happy path",
    dispute: "Try the dispute path",
    timeout: "Try: owner ignores it",
    fleet: "Try the Fleet Vault path",
  } satisfies Record<DemoPath, string>,
  outcome: {
    happy: "Settled in one click: the split was agreed",
    dispute: "Settled by the KeyEscrow dispute desk",
    timeout: "The owner stayed silent: full deposit back to the renter",
    fleet: "Damaged return settled: rent + damage payout went into the Fleet Vault",
  } satisfies Record<DemoPath, string>,
  terms: (property: string, rent: string, deposit: string) => `${property} · ${rent} / month · ${deposit} deposit. Final balances of this rental:`,
  tenant: "Renter",
  tenantNote: (paidIn: string) => `got back, of ${paidIn} paid in`,
  landlord: "Owner",
  landlordNote: "month 1 rent after fee + repairs",
  vault: "Fleet Vault",
  vaultNote: (symbol: string) => `owner's cut, shared by ${symbol} holders`,
  treasury: "KeyEscrow treasury",
  treasuryNote: "one-time fee",
  escrow: "Escrow contract",
  escrowNote: "left in escrow",
  balanced: (paidIn: string, tenant: string, landlord: string, treasury: string) =>
    `Balances add up: the renter's ${paidIn} went back to the renter (${tenant}), to the owner (${landlord}) and to the treasury (${treasury}). The escrow holds nothing.`,
  unbalanced: "✗ The balances do not add up. Open the rental page to inspect the timeline.",
  again: "Run again",
  openLease: "Open the rental page ↗",
  hide: "Hide ✕",
};

/** The live BSC testnet (chain 97) variant of the stage: same story, real public transactions signed by the server. */
const testnetCopy = {
  badge: "Live on BSC Testnet",
  badgeShort: "BSC Testnet",
  badgeTitle: "Every step is a real BSC testnet (chain 97) transaction, signed by KeyEscrow's demo wallets on the server. Click any hash to open it on BscScan.",
  pageIntro:
    "One click plays the whole KeyEscrow story live on BSC Testnet: real contracts, real public transactions you can open on BscScan, and the real rental page updating underneath. No wallet needed: KeyEscrow's demo owner, renter and dispute desk sign on the server.",
  bullets: [
    "A fresh scooter rental, created, funded and settled with real transactions on BSC Testnet (chain 97). Each one takes a few seconds to confirm.",
    "Every transaction in the story column links to BscScan, and the balances on the left are read live from the chain.",
    "Every amount in baht first, then dollars and the exact mUSDT on-chain.",
    "The AI return inspection, the KeyEscrow fee going to the treasury, and the final balances.",
  ],
  timeoutNote: "Owner ignores it needs 7 days of real time on a public chain; play it on the local demo.",
  timeoutShort: "needs 7 days; play it on the local demo",
  waiting: (code: "busy" | "rate-limited", sec: number) =>
    code === "busy" ? `Someone else is playing the live demo. Free in ~${sec} s; yours starts by itself.` : `The live demo just ran. Yours starts in ${sec} s…`,
  presenting: "One live run at a time. Pick Step by step to click through it; Pause works any time.",
  txTitle: (hash: string) => `Open transaction ${hash} on BscScan`,
  topUp: (role: string) => `Gas top-up for the ${role} (tBNB from KeyEscrow)`,
  reverted: (label: string, url: string) => `"${label}" was reverted on BSC testnet. See why on BscScan: ${url}`,
  noRpc: "Could not reach BSC testnet. Check your connection and press Retry.",
  escrowOnBscscan: "View the escrow on BscScan ↗",
  unsigned:
    "Report by the KeyEscrow Inspector agent. Unsigned on this testnet demo server (no INSPECTOR_PRIVATE_KEY set); with its key set, every report is signed by the agent's ERC-8004 identity on BNB Chain.",
  off: "The live testnet demo is switched off on this server. Connect a wallet to use KeyEscrow on BSC testnet, or play the demo on a local build.",
  loading: "Loading the live testnet demo…",
  ctaTitle: "See the whole story in one click, live on BSC Testnet",
  ctaBody: "A fresh scooter rental, funded, paid out, inspected by AI and settled, with real BSC testnet transactions you can open on BscScan. No wallet needed. About two minutes.",
};

/** Guided speed: the intro card, the three beats of every step, the transaction lines and the presenter keys. */
const guidedCopy = {
  speed: "Guided",
  speedTitle: "Slow, explained: each step says what happens, runs it, then shows what changed",
  normalTitle: "One short caption per step",
  fastTitle: "No pauses",
  beat: { intro: "Before we start", now: "What happens now", run: "On-chain now", changed: "What just changed" },
  back: "← Back",
  next: "Next →",
  pressNext: "Press Next → to continue.",
  paused: "Paused. Press Resume or the space bar.",
  reviewing: "Looking back: this already happened. Next → returns to the live demo.",
  keys: "Space pauses · ← → move through the captions",
  why: "Why it matters",
  /** The transaction lines of the "On-chain now" beat. */
  signing: (who: string) => `Signing as ${who}`,
  calling: (contract: string, fn: string, args: string) => `calling ${contract}.${fn}(${args})`,
  upload: (n: number) => `Storing ${n} file${n === 1 ? "" : "s"} off-chain; only the fingerprint${n === 1 ? "" : "s"} will go on-chain`,
  inspect: "AI Inspector comparing the start and end photos",
  time: (seconds: number) => `Jumping the demo chain's clock forward ${Math.round(seconds / 86_400)} days`,
  confirmed: "confirmed",
  failed: "failed",
  nothingYet: "Starting…",
  /** The actor cards while a step runs. */
  acting: "▶ Acting now",
  receiving: "← Receives",
  intro: {
    title: "How KeyEscrow works",
    body:
      "Renting a scooter in Thailand often means leaving your passport or a cash deposit at the shop, and getting it back can be hard. " +
      "KeyEscrow puts the deposit in escrow (held by a neutral party): a smart contract on BNB Chain that nobody can change.",
    cast: "Who is who",
    see: "What you will see",
    beats: "Every step has three parts: what happens now, the transaction itself, and what just changed.",
  },
};

const en = { pageTitle, pageIntro, actorLabel, actorCards, controls, intro, panels, errorCopy, inspectionCopy, summaryCopy, testnetCopy, guidedCopy };
export type DemoCopy = typeof en;
/** The /demo copy in a language: `useT().of(demoCopy)`. */
export const demoCopy = localized(en, zh);
