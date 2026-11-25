import type { Rhythm } from "@/lib/fleet";
import type { SubState } from "@/lib/subscriptions";

/** Every user-facing string of the subscription views, in one place for translation. */
export const copy = {
  pageTitle: "Subscriptions",
  pageIntro:
    "Ride a scooter month by month. You pay one month at a time; the deposit stays locked in the rental's own escrow, never your passport. Cancel any time by returning the scooter: the deposit comes back after the return check.",
  gate: "subscribe to a scooter",
  rhythm: { 7: "Weekly", 14: "Every 2 weeks", 30: "Monthly" } satisfies Record<Rhythm, string>,
  per: { 7: "week", 14: "2 weeks", 30: "month" } satisfies Record<Rhythm, string>,
  rhythmLabel: "Payment rhythm",
  rhythmSoon: "Weekly and every-2-weeks plans come with the next contract version.",

  plans: {
    title: "Plans available",
    empty: "No scooter is offered as a subscription on this network yet.",
    deposit: (thb: string) => `${thb} deposit in escrow, no passport`,
    term: (n: number) => `Up to ${n} months · cancel any time with a return check`,
    upfront: "To start: deposit + month 1",
    subscribe: "Subscribe",
    requested: "Requested. The shop now issues your contract.",
    notAvailable: "Not available right now.",
    connect: "Connect a wallet to subscribe.",
  },

  mine: {
    title: "My subscriptions",
    empty: "No subscriptions for this wallet yet. Pick a plan above.",
    nextPayment: "Next payment",
    paidThrough: (n: number, of: number) => `${n} of ${of} months paid`,
    deposit: "Deposit (comes back after the return check)",
    open: "Open rental",
    loading: "Loading your wallet…",
    getUsdt: "Get test USDT",
    start: "Pay deposit + month 1",
    pay: (n: number) => `Pay month ${n}`,
    payHint: "Two wallet steps if needed: approve, then pay. Paid into escrow, paid out to the shop as each month comes due.",
    notEnough: "Not enough USDT in your wallet yet. Get test USDT first.",
    allPaid: "Every month of the term is paid.",
    cancel: "Cancel subscription",
    cancelTitle: "Cancel this subscription?",
    cancelBody:
      "Cancelling means returning the scooter. On the rental page you take the guided return photos, the AI inspection compares them with the pickup photos and proposes the deposit split, and you and the shop settle it. Your deposit comes back after that return check, minus only new damage. Months you paid ahead and did not use come back too.",
    cancelConfirm: "Start the return",
  },

  state: {
    requested: () => "Waiting for the shop to issue your subscription contract.",
    issued: () => "Contract ready. Pay the deposit and month 1 to start riding.",
    active: (due: string, amount: string) => `Active. Next payment ${amount} on ${due}.`,
    activePaid: () => "Active. Every month of the term is paid.",
    overdue: (due: string, amount: string) => `Payment of ${amount} was due on ${due}. Pay now to keep riding.`,
    cancelling: () => "Cancelling: return check in progress. The deposit comes back after it.",
    disputed: () => "Cancelling: the dispute desk reviews the return photos.",
    ended: () => "Ended. Deposit settled.",
  } satisfies Record<SubState | "activePaid" | "overdue", (...a: string[]) => string>,

  owner: {
    title: "Subscriptions",
    mrr: "Monthly recurring revenue",
    mrrHint: (usdt: string) => `${usdt} mUSDT a month from active subscriptions`,
    subscribers: "Active subscribers",
    offerTitle: "Offer as subscription",
    scooter: "Scooter",
    price: "Price per month (THB)",
    deposit: "Deposit (THB)",
    maxMonths: "Max months",
    maxMonthsHint: "The rental term. The renter pays month by month and can cancel any time by returning the scooter.",
    save: "Offer as subscription",
    saved: (name: string) => `${name} is now offered as a subscription.`,
    noScooters: "Add a scooter first; then offer it as a subscription.",
    plansEmpty: "No subscription plans yet.",
    planCard: (months: number) => `up to ${months} months`,
    subscriberOf: (n: number) => (n ? `${n} active subscriber${n === 1 ? "" : "s"}` : "no active subscriber"),
  },

  shareholders: {
    mrr: "Subscription MRR",
    hint: (n: number) => `${n} active subscriber${n === 1 ? "" : "s"} on vault scooters`,
  },
} as const;
