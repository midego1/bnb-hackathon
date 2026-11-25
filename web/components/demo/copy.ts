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
