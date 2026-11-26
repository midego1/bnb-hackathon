/** English UI strings for one group of app screens (see dictionaries/en.ts). JSON only: strings, `{name}` placeholders, nested objects. */
export const body = {
  /** The live judge demo's big screen (/stage/<slug>, components/stage/StageView.tsx) and the shared page bits. */
  stage: {
    metaTitle: "Rent it live",
    loading: "Loading…",
    disabled: "The live stage demo is not enabled on this server.",
    terms: "{rent} / day · {deposit} deposit",
    realMoney: "Real money (BSC mainnet), max 1 USD",
    qr: "QR code: {url}",
    openHere: "or open on this device",
    timeline: "Timeline",
    offline: "Reconnecting… the rental is safe on-chain; this screen catches up when the network is back.",
    money: { paid: "Renter paid", escrow: "In escrow", owner: "Owner got", back: "Back to renter", fee: "fee {fee}" },
    photos: { pickup: "Pickup", return: "Return", alt: "{title} photo" },
    /** The stage timeline: lib/stage.ts eventLabel, by event name. */
    event: {
      LeaseCreated: "Owner offered the rental: escrow created",
      Funded: "Renter paid deposit + rent into the escrow",
      pickupPhoto: "Pickup photo anchored on-chain",
      returnPhoto: "Return photo anchored on-chain",
      evidence: "Evidence anchored on-chain",
      SettlementProposed: "AI split proposed",
      Settled: "Both agreed: money settled",
      RentReleased: "Rent paid out to the owner",
      ProtocolFeePaid: "KeyEscrow fee paid",
      DisputeRaised: "Dispute raised",
      Cancelled: "Offer cancelled",
    },
    presenter: {
      accept: "Accept the split (owner)",
      acceptWhen: "Accept appears once the renter proposes a split.",
      reset: "Reset stage",
      resetConfirm: "Reset the stage? The current rental stays on-chain, but the next scan starts a fresh one.",
      code: "Presenter code",
    },
  },
  /** The judge's phone (/r/<slug>, components/stage/JudgeFlow.tsx). */
  judge: {
    connectFirst: "Connect your wallet first.",
    offline: "Connection is shaky. Your rental is safe on-chain; this screen catches up when the network is back.",
    guestWallet: "Testnet guest wallet, no real money",
    guestWalletMainnet: "Guest wallet · real money (BSC mainnet), max 1 USD",
    yourWallet: "Your wallet",
    another: "Use another wallet",
    money: {
      body: "We send this wallet a little test BNB for gas and {amount} in test dollars (mUSDT) for the rent and the deposit. Testnet only, no real money.",
      button: "Get test money",
      sent: { one: "Test money sent ({n} transaction).", other: "Test money sent ({n} transactions)." },
      bodyMainnet:
        "We send this wallet {amount} of real BSC-USD (USDT on BSC mainnet), exactly the rent and the deposit, and a little BNB for gas. Real money, max 1 USD. The deposit comes back to this wallet.",
      buttonMainnet: "Get 1 USD to rent with",
      sentMainnet: { one: "Sent on BSC mainnet ({n} transaction).", other: "Sent on BSC mainnet ({n} transactions)." },
    },
    rent: {
      rent: "Rent (1 day)",
      deposit: "Deposit (comes back)",
      body: "The money goes into this rental's own escrow contract on BNB Chain, not to the owner. Nobody can take the deposit alone.",
      preparing: "The owner is preparing your rental…",
      paying: "Paying into the escrow…",
      button: "Pay into escrow",
    },
    busy: "Only one rental at a time. Ask the presenter to reset the stage, then reload this page.",
    waiting: {
      body: "You proposed: {back} back to you, {kept} to the owner. The owner accepts on the big screen.",
      watching: "Watching the chain…",
    },
    settled: { body: "The escrow paid out and closed. Thanks for renting the {name}!", bscscan: "See it on BscScan", escrow: "Escrow {address}" },
    wallet: {
      guest: "Use a guest wallet",
      guestHint: "Testnet guest wallet, no real money. A fresh key is made on this phone and never leaves it.",
      guestHintMainnet: "Real money (BSC mainnet), max 1 USD. A fresh key is made on this phone and never leaves it.",
      metamask: "Connect MetaMask",
    },
    photos: {
      pickupBody: "Photograph the box as you get it (1 to 3 photos). Their fingerprints go on-chain, so nobody can swap them later.",
      returnBody: "Give the box back to the presenter and photograph it again (1 to 3 photos). The AI inspector compares them with the pickup photos.",
      alt: { pickup: "pickup photo", return: "return photo" },
      reading: "Reading photo…",
      another: "Take another photo",
      open: "Open the camera",
      atLeastOne: "Take at least one photo.",
      uploadFailed: "Photo upload failed, so only their fingerprints go on-chain.",
      save: {
        pickup: { zero: "Save pickup photos on-chain", one: "Save 1 pickup photo on-chain", other: "Save {n} pickup photos on-chain" },
        return: { zero: "Save return photos on-chain", one: "Save 1 return photo on-chain", other: "Save {n} return photos on-chain" },
      },
    },
    inspect: {
      body: "The AI inspector compares the pickup and return photos and proposes how to split the deposit.",
      waitingPhotos: "Waiting for the photos to show up on-chain…",
      run: "Run the AI inspection",
      back: "Back to you",
      owner: "To the owner",
      mock: "Demo inspector (no vision model key on this server): deterministic, not a real look at the photos.",
      propose: "Propose this split",
    },
  },
};

/** Headlines and the big status/banner sentences: these get the Chinese line under the English in EN+中文 (t.h). */
export const head = {
  /** The big screen's one-line status (StageView headline). */
  stage: {
    creating: "The owner is creating the rental…",
    scan: "Scan to rent the {name}",
    created: "Rental offered: waiting for the renter to pay",
    locked: "{amount} locked in escrow: pickup photos next",
    pickedUp: "Picked up: waiting for the return",
    returned: "Returned: the AI inspector is comparing photos",
    proposed: "AI split proposed: {back} back, {kept} to the owner",
    disputed: "In dispute: the dispute desk decides",
    settled: "Settled: both sides agreed, the money is paid out",
  },
  /** The judge's phone: one title per step. */
  judge: {
    wallet: "Rent it with one tap",
    money: "Get test money",
    moneyMainnet: "Get 1 USD to rent with",
    rent: "Rent it for {amount}",
    busy: "Someone else is renting it right now",
    pickup: "Take pickup photos",
    return: "Hand it back, then take return photos",
    inspect: "AI inspection",
    waiting: "Waiting for the owner",
    settled: "Your {amount} are back",
  },
};
