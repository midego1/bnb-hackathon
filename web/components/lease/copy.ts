/**
 * Every sentence of the rental page and the renter page (English). Kept in one object so a translation can replace it
 * whole; amounts arrive already formatted (baht first) and dates as unix seconds.
 */
const day = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const rentalCopy = {
  day,
  fallbackTitle: "Scooter rental",
  ownerShort: (a: string) => `owner ${a}`,
  period: (from: bigint, to: bigint) => `${day(from)} to ${day(to)}`,
  notStarted: "starts when the renter pays in",
  escrowLink: (short: string, explorer: boolean) => `Escrow ${short}${explorer ? " on BscScan" : ""}`,
  youAre: { landlord: "You are the owner", tenant: "You are the renter", arbiter: "You are the dispute desk" },
  readOnly: (wallet: boolean) => (wallet ? "Your wallet is not part of this rental: read-only." : "Connect a wallet to act on this rental."),
  back: { arbiter: "Dispute desk", landlord: "My fleet", tenant: "My rentals", none: "Home" },

  pill: {
    created: "Waiting for the renter to pay in",
    month: (m: number, term: number, u: string) => `Active, ${u} ${m} of ${term}`,
    proposal: "Return: deposit proposal open",
    closed: (at: bigint) => `Return · reply window closed ${day(at)}`,
    disputed: "In dispute",
    settled: "Closed",
    cancelled: "Offer withdrawn",
  },

  banner: {
    fundTitle: (total: string, u: string) => `Pay ${total} to start: the deposit plus ${u} 1.`,
    fundBody: "It goes into this rental's own escrow, not to the shop. The deposit stays locked there until you return the scooter.",
    fundAction: (total: string) => `Pay in ${total}`,
    fundNote: "Get test USDT, approve, then fund",
    waitFundTitle: "Waiting for the renter to pay in.",
    waitFundOwner: "Send the renter this page. Nothing has moved yet, and you can withdraw the offer until they pay.",
    waitFundOther: "Nothing has moved yet.",

    lockedTitle: (deposit: string, you: boolean) => `${you ? "Your" : "The"} ${deposit} deposit is locked in escrow.`,
    payBody: (paidThrough: number, next: number, due: bigint, u: string) =>
      `Rent is paid through ${u} ${paidThrough}. Pay ${u} ${next} by ${day(due)} to keep riding. The owner can never take the deposit alone.`,
    payAction: (next: number, rent: string, u: string) => `Pay ${u} ${next} · ${rent}`,
    payNote: "Approve, then pay: two wallet confirmations",
    allPaidBody: (term: string) => `All ${term} are paid in. At return, take the return photos and propose how to split the deposit.`,
    returnedTitle: "Your scooter is back. Propose how to split the deposit.",
    returnedBody: (days: number) => `The AI inspector compares the pickup and return photos and suggests a split. The owner then has ${days} days to reply.`,
    proposeAction: "Propose the split",

    collectTitle: (amount: string) => `${amount} of rent is ready for you.`,
    collectBody: (fee: string | null) =>
      fee ? `The one-time ${fee} KeyEscrow fee comes out of this first payout. Later payouts are the full rent.` : "No fee: the one-time KeyEscrow fee was already paid.",
    collectAction: (n: number, amount: string, u: string) => `Collect ${u} ${n} rent · ${amount}`,
    paidOwnerTitle: (n: string, net: string) => `${n} of rent paid: ${net} is in your wallet.`,
    runningTitle: "The rental is running.",
    nextDueBody: (due: bigint) => `The renter's next rent is due ${day(due)}. The deposit stays locked until return.`,
    allRentBody: "All rent is paid out. The deposit stays locked until the scooter is returned.",
    idleUntil: (due: bigint) => `Nothing for you to do until ${day(due)}`,

    noDisputeTitle: "No dispute on this rental.",
    noDisputeBody: "You only rule if the renter and the owner disagree about the deposit at return. Until then you cannot move any money.",
    nothingToRule: "Nothing for you to rule on",
    monthOf: (m: number, term: number, u: string) => `${cap(u)} ${m} of ${term}. Only the renter and the owner act on this rental.`,

    proposedTitle: (by: string, back: string, kept: string) => `The ${by} proposed: ${back} back to the renter, ${kept} to the owner.`,
    replyBy: (at: bigint, owner: boolean) =>
      `Reply by ${day(at)}: accept, counter or open a dispute.${owner ? " Without a reply, the renter gets the full deposit back." : ""}`,
    replyAnytime: "Accept it, counter it or open a dispute.",
    replyAction: "Reply to the proposal",
    yourProposalTitle: "Your proposal is waiting for the other side.",
    theyHaveUntil: (at: bigint) => `They have until ${day(at)} to answer. After that you can claim the full deposit.`,
    theyDecide: "They can accept it, counter it or open a dispute.",
    proposalWaitingTitle: "A deposit proposal is waiting for an answer.",

    claimTitle: (deposit: string) => `Claim your full ${deposit} deposit.`,
    claimBody: (days: number) => `The owner did not reply to your proposal within ${days} days, so the deposit is yours. One confirmation moves it to your wallet.`,
    claimAction: (deposit: string) => `Claim deposit · ${deposit}`,
    closedOwnerTitle: (at: bigint) => `The reply window closed on ${day(at)}.`,
    closedOwnerBody: (days: number, deposit: string) =>
      `You had ${days} days to accept, counter or dispute the renter's proposal. None arrived, so the renter can now claim the full ${deposit} deposit. Rent already paid to you is not affected.`,
    closedGone: "Accept, counter and dispute can no longer be sent.",
    closedOtherTitle: "Nothing to rule on: no dispute was opened in time.",
    closedOtherBody: (deposit: string) => `The owner's reply window closed. The renter can claim the full ${deposit} deposit.`,

    ruleTitle: "Rule on the deposit split.",
    ruleBody: (at: bigint) => `Rule by ${day(at)}. You can only split the deposit between the renter and the owner, nothing else.`,
    ruleAction: "Rule now",
    deskDecidingTitle: "The dispute desk is deciding.",
    deskDecidingBody: (at: bigint) => `It rules by ${day(at)}. If it does not, the full deposit goes back to the renter.`,
    deskLateTitle: "The dispute desk missed its deadline.",
    deskLateBody: "Anyone can now return the full deposit to the renter.",
    deskLateAction: (deposit: string) => `Return ${deposit} to the renter`,

    settledTenantTitle: (back: string) => `Closed: you got ${back} back.`,
    settledOwnerTitle: (net: string) => `Closed: you received ${net} in total.`,
    settledTitle: "Closed: all money is paid out.",
    settledBody: "This rental is finished and its escrow is empty.",
    cancelledTitle: "The owner withdrew this offer.",
    cancelledBody: "Nothing was paid in.",

    nothing: "Nothing for you to do",
    nothingLeft: "Nothing left to do",
    oneConfirmation: "One wallet confirmation",
  },

  monthsLabel: "Rental progress by rent period",
  month: (n: number, u: string) => `${cap(u)} ${n}`,
  monthPaidOut: "paid",
  monthPaidIn: "paid in",
  monthDue: (at: bigint) => `due ${day(at)}`,
  returnOn: (at: bigint) => `Return ${day(at)}`,

  strip: {
    paidIn: (you: boolean) => `Renter${you ? " (you)" : ""} paid in`,
    escrow: "This rental's escrow",
    owner: (you: boolean) => `Owner${you ? " (you)" : ""} received`,
    vault: "Fleet Vault received",
    stillToPay: (rent: string) => `Still to pay: ${rent} rent`,
    allPaidIn: "All rent paid in",
    gotBack: (v: string) => `Got back ${v}`,
    escrowEmpty: "Empty until the renter pays in",
    escrowLocked: "The deposit, locked until return",
    escrowAhead: "The deposit plus rent paid in ahead",
    escrowClaim: "Ready for the renter to claim",
    escrowDone: "Empty: everything is paid out",
    afterFee: (fee: string) => `After the one-time ${fee} fee`,
    feeLater: "The one-time fee comes out of the first payout",
    trust: "Only moves when you both agree, or the dispute desk rules.",
    fee: (pct: string) => `Fee: ${pct}% of one month's rent, once, from the first payout. Never from the deposit.`,
  },

  timeline: { title: "What happened", sub: "newest last · every step is a transaction", none: "Nothing yet.", payee: "The owner's rent goes to the Fleet Vault" },

  ret: {
    title: "What happens at return",
    planned: (at: bigint) => `Planned for ${day(at)}`,
    photos: "Return photos",
    photosSub: "The same angles as at pickup, taken at drop-off.",
    split: "A split is proposed",
    splitSub: "The AI inspector compares pickup and return photos.",
    reply: (days: number) => `The other side replies within ${days} days`,
    replySub: "Accept, counter, or open a dispute.",
    desk: (days: number) => `Dispute desk rules within ${days} days`,
    deskSub: "Only if disputed. It can split the deposit, nothing else.",
    back: "Otherwise the full deposit goes back",
    backSub: "No reply or ruling in time: the renter claims the whole deposit.",
    by: (at: bigint) => `by ${day(at)}`,
    on: (at: bigint) => day(at),
    closed: (at: bigint) => `closed ${day(at)}`,
    now: "now",
    skipped: "skipped",
    ifDisputed: "only if disputed",
    afterDeadline: "after a deadline",
    later: "later",
  },

  details: "Do it here",

};

export type RentalCopy = typeof rentalCopy;
