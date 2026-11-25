import type { DemoActor, DemoPath } from "@/lib/demo/script";

/**
 * Every user-facing string of the /demo stage UI in one place (the step narration itself lives with the steps in
 * lib/demo/script.ts). Layout components import from here and hold no copy of their own.
 */

export const pageTitle = "Play the demo";
export const pageIntro =
  "One click plays the whole KeyEscrow story on the local chain: real contracts, real transactions, and the real lease page updating live underneath. The demo accounts switch by themselves.";

export const actorLabel: Record<DemoActor, string> = {
  landlord: "Landlord",
  tenant: "Tenant",
  arbiter: "Dispute desk",
  inspector: "KeyEscrow Inspector (AI agent)",
  anyone: "Anyone",
};

/** The actor cards on the left of the stage. */
export const actorCards = {
  landlord: { name: "Landlord", note: "Offers the lease, gets the rent" },
  tenant: { name: "Tenant", note: "Pays deposit + rent into escrow" },
  escrow: { name: "Escrow contract", note: "This lease only: holds the deposit", empty: "Created in step 1" },
  treasury: { name: "KeyEscrow treasury", note: "Platform fee: one-time, from month 1" },
  arbiter: { name: "Dispute desk", note: "Rules on disputes. Holds no money." },
  inspector: { name: "AI Inspector", note: "Drafts the split. Holds no money." },
  faucet: "MockUSDT faucet",
} as const;

export const controls = {
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
  restart: "↺ Restart",
  connecting: "Connecting to the local chain…",
  paused: "Paused. Press Resume to continue.",
  pausing: "Pausing after this step…",
  showSummary: "Show the summary",
};

export const intro = {
  title: "What you are about to see",
  bullets: [
    "A fresh Bangkok lease, created, funded and settled with real transactions on this local anvil chain.",
    "The demo switches between the landlord, tenant and dispute desk accounts for you (watch the yellow bar).",
    "Every amount in baht first, then dollars and the exact mUSDT on-chain.",
    "The AI move-out inspection, the KeyEscrow fee going to the treasury, and the final balances.",
  ],
  presenting: "Presenting live? Pick Step by step: each step waits for your click. Pause works any time.",
};

export const panels = {
  story: "The story",
  live: "The real lease page, live",
  liveNote: "The same component landlord and tenant use, re-rendered after every transaction.",
  liveEmpty: "The lease page appears here as soon as the landlord has created the lease.",
  openTab: "Open in its own tab ↗",
  moved: "Money moved",
  nothingMoved: "No money moved in this step.",
  working: "working…",
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  txTitle: (hash: string) => `Transaction ${hash}: see it on the lease timeline`,
};

export const errorCopy = {
  title: (n: number, title?: string) => `Step ${n} (${title}) did not work`,
  retry: "Retry this step",
  startOver: "Start over with a fresh lease",
};

export const inspectionCopy = {
  title: "AI move-out inspection",
  back: "Back to tenant",
  keeps: "Landlord keeps (repairs)",
  signed: (name: string, agentId?: string | number) =>
    `Signed by ${name}${agentId !== undefined ? `, ERC-8004 agent #${agentId}` : ""}: its identity is registered on BNB Chain, so anyone can check this report came from it.`,
  unsigned:
    "Report by the KeyEscrow Inspector agent. Unsigned on this local demo (no INSPECTOR_PRIVATE_KEY set); with its key set, every report is signed by the agent's ERC-8004 identity on BNB Chain.",
  meta: (confidence: number, mock: boolean, provider: string) =>
    `Confidence ${(confidence * 100).toFixed(0)}% · ${mock ? "demo inspector (no AI key configured)" : `vision model: ${provider}`} · report`,
};

export const summaryCopy = {
  tryLabel: {
    happy: "Try the happy path",
    dispute: "Try the dispute path",
    timeout: "Try: landlord ignores it",
  } satisfies Record<DemoPath, string>,
  outcome: {
    happy: "Settled in one click: the split was agreed",
    dispute: "Settled by the KeyEscrow dispute desk",
    timeout: "The landlord stayed silent: full deposit back to the tenant",
  } satisfies Record<DemoPath, string>,
  terms: (property: string, rent: string, deposit: string) => `${property} · ${rent} / month · ${deposit} deposit. Final balances of this lease:`,
  tenant: "Tenant",
  tenantNote: (paidIn: string) => `got back, of ${paidIn} paid in`,
  landlord: "Landlord",
  landlordNote: "month 1 rent after fee + repairs",
  treasury: "KeyEscrow treasury",
  treasuryNote: "one-time fee",
  escrow: "Escrow contract",
  escrowNote: "left in escrow",
  balanced: (paidIn: string, tenant: string, landlord: string, treasury: string) =>
    `✓ Balances add up: the tenant's ${paidIn} went back to the tenant (${tenant}), to the landlord (${landlord}) and to the treasury (${treasury}). The escrow holds nothing.`,
  unbalanced: "✗ The balances do not add up. Open the lease page to inspect the timeline.",
  again: "↺ Run again",
  openLease: "Open the lease page ↗",
  hide: "Hide ✕",
};

/** The live BSC testnet (chain 97) variant of the stage: same story, real public transactions signed by the server. */
export const testnetCopy = {
  badge: "Live on BSC Testnet",
  badgeShort: "BSC Testnet",
  badgeTitle: "Every step is a real BSC testnet (chain 97) transaction, signed by KeyEscrow's demo wallets on the server. Click any hash to open it on BscScan.",
  pageIntro:
    "One click plays the whole KeyEscrow story live on BSC Testnet: real contracts, real public transactions you can open on BscScan, and the real lease page updating underneath. No wallet needed: KeyEscrow's demo landlord, tenant and dispute desk sign on the server.",
  bullets: [
    "A fresh Bangkok lease, created, funded and settled with real transactions on BSC Testnet (chain 97). Each one takes a few seconds to confirm.",
    "Every transaction in the story column links to BscScan, and the balances on the left are read live from the chain.",
    "Every amount in baht first, then dollars and the exact mUSDT on-chain.",
    "The AI move-out inspection, the KeyEscrow fee going to the treasury, and the final balances.",
  ],
  timeoutNote: "Landlord ignores it needs 7 days of real time on a public chain; play it on the local demo.",
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
  ctaBody: "A fresh Bangkok lease, funded, paid out, inspected by AI and settled, with real BSC testnet transactions you can open on BscScan. No wallet needed. About two minutes.",
};
