import { localized } from "@/lib/i18n/locales";
import { ARBITER_DAYS, baht, CONTRACT_TESTS, EXAMPLE, FEE_PERCENT, FLEET_OPERATOR_FEE_PERCENT, INSPECTOR_AGENT, OWNER_RESPONSE_DAYS, TESTNET_CONTRACTS } from "@/lib/marketing";
import { zh } from "./copy.zh";

/**
 * Every word of the marketing page at /, in English; Chinese in copy.zh.ts. The facts (amounts, days, addresses)
 * come from lib/marketing.ts. A string array is lines (headline breaks) or, for rich text, the parts around a link or
 * code span. Headlines (`title`, `h1`, the h3s) get the Chinese line in EN+中文; the rest stays English there.
 */
const en = {
  meta: {
    title: "KeyScrow: rent a scooter in Thailand without leaving your passport",
    description:
      "The deposit for a scooter rental sits in its own smart contract on BNB Chain instead of a passport at the counter. Nobody moves it alone: an AI inspection proposes the split at return, people decide, and deadlines protect the renter. Live on BSC testnet.",
    cardAlt: `KeyScrow: rent the scooter, keep your passport. An LED sign reads ${baht(EXAMPLE.deposit)} in escrow, over a scooter rental shop on a Thai street at night.`,
  },
  header: {
    nav: [
      ["#listings", "Scooters"],
      ["#how", "Your deposit"],
      ["#shops", "List your scooter"],
      ["#live", "Proof"],
      ["#fee", "Fee"],
    ] as [string, string][],
    home: "KeyScrow, home",
    openApp: "Open the app",
  },
  hero: {
    label: "KeyScrow in one screen",
    artAlt:
      "LED dot-matrix picture of a Thai street at night: a red scooter parked in front of a lit scooter rental shop, a palm tree, power lines and a temple spire.",
    h1: ["Rent the scooter.", "Keep your passport."],
    body: "Find a scooter in Thailand and start the rental right here. The deposit goes into its own smart contract on BNB Chain instead of your passport, and nobody can move it alone.",
    playDemo: "Play the live demo",
    mysteryBox: "Rent our Mystery Box",
    mysteryBoxHint: "The live judge demo: rent the box we brought to the stage, with test money",
    openApp: "Open the app",
    how: "How it works",
    ways: "Other ways in",
    testnet: "Demo listings on BSC testnet: test money only",
    testnetMore: ". Open source, no token",
  },
  search: {
    label: "Find a scooter",
    where: "Where",
    anywhere: "Anywhere in Thailand",
    anywhereShort: "Anywhere",
    when: "When",
    anyDate: "Any date",
    how: "How long",
    lengths: { day: "By the day", week: "By the week", month: "By the month" },
    submit: "Search",
    cities: { "Chiang Mai": "Chiang Mai", Bangkok: "Bangkok", Phuket: "Phuket", Pai: "Pai" } as Record<string, string>,
  },
  listings: {
    title: "Pick a scooter. The deposit goes into escrow.",
    count: (n: number) => `${n} demo listing${n === 1 ? "" : "s"}`,
    inCity: (city: string) => ` in ${city}`,
    by: { day: "", week: ", by the week", month: ", by the month" },
    from: (date: string) => `, from ${date}`,
    all: "Show all",
    demo: "Demo listings on BSC testnet. Renting one pays the deposit and the first month's rent into its own escrow, with test money. They are not real shops' offers, and every one is open on every date.",
    none: "No demo listing there yet.",
    per: { day: "per day", week: "per week", month: "per month" },
    deposit: (amount: string) => `Deposit ${amount}`,
    badge: "Deposit protected by escrow",
    demoTag: "Demo listing",
    stageTag: "Live stage demo",
    onStage: "On stage, BNB Bangkok",
    alt: (name: string, place: string) => `Photo of a ${name}, the model of this demo listing in ${place}.`,
    boxAlt: "Photo of a closed cardboard box, standing in for the KeyScrow Mystery Box rented live on stage.",
  },
  counter: {
    title: "The same counter, with nobody holding your passport.",
    lead: "Renters fear bogus damage claims. Shop owners face real damage with no proof. Neither has anyone neutral to turn to, and nobody goes to court over a few thousand baht.",
    today: "Today",
    ours: "With KeyScrow",
    art: [
      "LED picture of an open shop drawer holding a passport and a stack of banknotes.",
      `LED picture of a small lit house with a keyhole, the KeyScrow mark, with ${baht(EXAMPLE.deposit)} glowing above it.`,
    ],
    rows: [
      ["The deposit", "Your passport or cash, in the shop's drawer", "Tokens in a contract made for this one rental"],
      ["Proof of the scooter's condition", "A few chat photos, if any", "Guided pickup and return photos, their fingerprints stored on-chain"],
      ["At return", "Whoever holds the passport wins the argument", "An AI inspection proposes a split; both sides accept, or the dispute desk rules"],
      ["If the other side goes quiet", "You wait, or you fly home without it", `After ${OWNER_RESPONSE_DAYS} days of silence the full deposit goes back to the renter`],
    ] as [string, string, string][],
  },
  live: {
    title: "Live on BSC testnet. Check it yourself.",
    proofLabel: "Proof that it is real",
    proof: [
      ["Live on BSC testnet", "chain 97, test money"],
      ["Contract v2", "source verified"],
      [`${CONTRACT_TESTS} contract tests`, "unit, fuzz and invariant"],
      [`ERC-8004 agent #${INSPECTOR_AGENT.id}`, "the AI inspector's on-chain identity"],
    ] as [string, string][],
    lead: `Contract v2 runs on BSC testnet (chain 97) and its source is verified, so what runs is what is in the repo, with ${CONTRACT_TESTS} Foundry tests behind it. The contracts are small and non-upgradeable. Nobody holds an admin key over a rental's funds: the deposit can only go to the two sides named at creation, and the dispute desk can only rule on a rental that is in dispute. Test money only: there is no mainnet deployment yet.`,
    caption: "KeyScrow contracts on BSC testnet",
    cols: ["Contract", "What it does", "Address (BscScan testnet)"],
    roles: Object.fromEntries(TESTNET_CONTRACTS.map((c) => [c.name, c.role as string])) as Record<(typeof TESTNET_CONTRACTS)[number]["name"], string>,
    tests: [`All ${CONTRACT_TESTS} contract tests, in the repo`, "The inspector's ERC-8004 registration"],
    prices: "Prices in baht, with the source on show",
    pricesBody:
      "Everyone at the counter thinks in baht, so every amount is shown in THB first, then USD and the exact token amount. Rates come from the Atlas on-chain feed or the CoinMarketCap Pro API, read on the server, and a badge always says which one you are looking at: Atlas feed, Live CoinMarketCap or Demo rates.",
    risk: "A deposit that keeps covering the repair bill",
    riskBody: [
      "The risk engine turns CoinMarketCap volatility into a deposit buffer: none for a stablecoin, more for BNB, and a token that swings too much is refused. ",
      "See each integration and its recent calls",
      ", including which ones are live on this server.",
    ],
  },
  how: {
    title: "How your deposit is protected, in four steps.",
    lead: "Follow the money of one real-sized rental, from the counter to the refund. The deposit never sees the shop's drawer.",
    cartoon: "Watch it as a one-minute cartoon",
    board: {
      label: "Where the example rental's money is, step by step",
      renter: "Renter",
      escrow: "Escrow",
      escrowSub: "this rental's own contract",
      owner: "Owner",
      renterHas: "with the renter",
      held: "in escrow",
      ownerHas: "with the owner",
      passport: "Passport: still in your pocket",
      fee: `KeyScrow fee ${baht(EXAMPLE.fee)}, once`,
      steps: "Steps of the rental",
      play: "Play the steps",
      pause: "Pause",
      ending: "How the return ends",
      clean: "No new damage",
      damage: "New damage",
    },
    steps: [
      {
        title: "The shop offers the scooter",
        body: "Rent, deposit and how often rent is due, priced in baht. The agreement and the guided pickup photos stay off-chain; only their SHA-256 fingerprints go on-chain.",
      },
      {
        title: "The renter funds the escrow",
        body: `${baht(EXAMPLE.funded)} goes into this rental's own contract: the ${baht(EXAMPLE.deposit)} deposit and the first month's rent. No passport crosses the counter.`,
      },
      {
        title: "Ride. Rent is paid out on schedule",
        body: `The first month's rent is released to the owner: ${baht(EXAMPLE.firstPayout)}, after KeyScrow's one-time ${baht(EXAMPLE.fee)} fee. The ${baht(EXAMPLE.deposit)} deposit stays where it is.`,
      },
      {
        title: "Return the scooter, settle in minutes",
        body: "An AI inspection compares pickup and return photos and proposes a split. One side proposes, the other accepts, and the deposit moves at once.",
      },
    ] as { title: string; body: string }[],
    cta: "See it happen on-chain",
    damageBody: `With new damage, the example proposal sends ${baht(EXAMPLE.claim)} to the owner and ${baht(EXAMPLE.refund)} back to the renter. Both still have to agree, or the dispute desk rules.`,
    note: `The board follows the example rental: a ${EXAMPLE.scooter} at ${baht(EXAMPLE.rent)} a month with a ${baht(EXAMPLE.deposit)} deposit, at an illustrative 1 USDT = 34 THB. On testnet the token is mUSDT, a test stablecoin.`,
  },
  inspection: {
    title: "The AI proposes. People decide.",
    lead: "At return, a vision model compares the pickup photos with the return photos and proposes how to split the deposit, with its reasons. It cannot move a single baht.",
    points: [
      ["Bounded.", "The refund and the claim always add up to the deposit, and never more."],
      ["Two signatures.", "One side submits the proposal on-chain, the other accepts. Either can dispute it instead."],
      ["Signed.", `Reports are signed by the KeyScrow Inspector, ERC-8004 agent #${INSPECTOR_AGENT.id} on BSC testnet, so anyone can check who wrote them.`],
      ["With a memory.", "The inspector looks up the scooter's earlier inspections first, so an old scratch is not billed twice."],
    ] as [string, string][],
    photos: [
      ["pickup-left", "Pickup", "Illustrated scooter seen from the left at pickup, with no damage."],
      ["return-left", "Return", "The same scooter at return, with new scratches circled on the left side panel."],
    ] as [string, string, string][],
    codeLabel: "Example inspection proposal",
    code: `{
  // mUSDT back to the renter
  "tenantRefund": "170.00",
  // mUSDT to the owner
  "landlordClaim": "30.00",
  "reasons": [
    "New scratches on the left side panel",
    "Left mirror cracked; intact at pickup"
  ]
}`,
    caption:
      `The demo's illustrated photo set and an example proposal on a 200 mUSDT (${baht(EXAMPLE.deposit)}) deposit. Where no vision-model key is set (the public testnet site, at the time of writing), a scripted demo inspector answers in the same format, and the app says so. The contracts say tenant and landlord where this page says renter and owner.`,
  },
  deadlines: {
    title: "Every dispute has a deadline.",
    lead: "The KeyScrow dispute desk is the default arbiter; an owner can name another neutral one, and the renter sees who it is before paying. Whoever it is, the clock protects the renter.",
    day: (n: number) => `Day ${n}`,
    lanes: [
      { title: "You agree", end: "Settled at once", body: "One side proposes the split, the other accepts. The deposit moves in the same transaction." },
      {
        title: "The owner goes quiet",
        end: `Day ${OWNER_RESPONSE_DAYS}: full deposit back to the renter`,
        body: `If the owner ignores the renter's proposal for ${OWNER_RESPONSE_DAYS} days, the renter can claim the whole deposit.`,
      },
      {
        title: "You disagree",
        end: `A ruling by day ${ARBITER_DAYS}, or the full deposit goes back to the renter`,
        body: `The dispute desk rules with the photos, both proposals and the AI report in front of it, and it has ${ARBITER_DAYS} days to do so.`,
      },
    ],
    note: `${OWNER_RESPONSE_DAYS} and ${ARBITER_DAYS} days are the defaults; each rental fixes its own windows when it is created.`,
    desk: "Open the dispute desk",
  },
  shops: {
    title: "List your scooter.",
    lead: "Own scooters? List them with a price and a deposit in baht. Real damage gets real evidence, rent arrives on schedule, and the deposit stays locked until the return is settled, even when the renter flies home tomorrow.",
    list: "List a scooter in the fleet owner view",
    subs: {
      title: "Rent by the week, every 2 weeks or by the month",
      body: `Offer a scooter as a subscription: a monthly price and a deposit in baht, and how often rent is due. The renter pays each period into the same escrow, and cancelling is the normal return: photos, AI proposal, settle. The fee stays ${FEE_PERCENT}% of one month's rent, once.`,
      rhythms: ["Weekly", "Every 2 weeks", "Monthly"],
      per: "per payment",
      caption: `The ${EXAMPLE.scooter} at each rhythm: the monthly price x days / 30, rounded down. The renter pays each period by hand today; auto-renew is on the roadmap.`,
      link: "See the subscription plans",
    },
    vault: {
      title: "Fleet Vault: one fleet, many owners",
      body: "Point a scooter's income at a vault instead of your own wallet. Rent and damage payouts land in the vault and are shared among whoever holds its BKK-FLEET-1 shares. You keep every role in the rental; only the payouts move.",
      owners: "Open the fleet owner view",
      holders: "Open the shareholder view",
      splitLabel: (rest: number) => `Of every baht of vault income, ${FLEET_OPERATOR_FEE_PERCENT}% goes to the operator and ${rest}% to shareholders.`,
      operator: `${FLEET_OPERATOR_FEE_PERCENT}% operator`,
      toHolders: (rest: number) => `${rest}% to shareholders, pro rata`,
      caption: "A testnet prototype. Revenue-sharing tokens can be securities; compliant issuance and resale of shares are next steps, and this prototype does neither.",
    },
    desk: {
      title: "A dispute desk that cannot stall",
      body: `Disagree with a renter and a neutral desk rules on the evidence, not on who shouts loudest at the counter. It can only rule on a rental that is in dispute, and it has ${ARBITER_DAYS} days: after that the deposit returns to the renter, so nobody can sit on the money.`,
      sees: "What the desk rules on",
      evidence: ["Guided pickup and return photos, fingerprinted on-chain", "The split each side proposed", "The AI inspector's report"],
      link: "Open the dispute desk",
    },
  },
  agents: {
    title: "Built for agents, not only for browsers.",
    lead: [
      "Every rental action is defined once and served three ways: a REST endpoint, an MCP tool and an A2A skill. The ",
      " actions return unsigned transactions, already simulated on the chain, for your own wallet to sign. KeyScrow never holds a key.",
    ],
    inspector: [`The inspector is an agent too: ERC-8004 agent #${INSPECTOR_AGENT.id} in the Identity Registry on BSC testnet (`, "registration", "). Other agents can find it, call it and verify what it signed."],
    developers: "Developer reference",
    docs: "Agent docs",
    codeLabel: "Connect Claude Code to the local KeyScrow MCP server",
    code: `# the agent, from a checkout of the repo
pnpm agent:dev

# then, in Claude Code
claude mcp add --transport http keyscrow \\
  http://127.0.0.1:8790/mcp`,
    tools: (rental: number, inspector: number) => `${rental} rental tools and ${inspector} inspector tools`,
  },
  fee: {
    title: `${FEE_PERCENT}% of one month's rent. Once.`,
    body: "Paid by the owner out of the first rent payout, however long the rental runs. Never taken from the deposit: that is the renter's money until the rental is settled. The renter pays nothing extra, and there is no token.",
    caption: `A ${EXAMPLE.scooter} rented by the month, in baht`,
    rows: [
      "Monthly rent",
      "Deposit, two months, instead of the passport",
      "Renter pays in at pickup: deposit and month 1",
      "KeyScrow fee, once",
      "Owner receives for month 1",
      "Owner receives for each later month",
    ],
    note: "Illustrative rate of 1 USDT = 34 THB. Over a three-month rental the fee is about 3% of the rent. The rate is capped in the factory contract, and each rental keeps the rate it was created with.",
  },
  roadmap: {
    title: "Where this goes next.",
    lead: "Today KeyScrow is a working testnet build, not a business with customers. This is the plan from here.",
    live: "Live on testnet",
    planned: "Planned",
    phases: [
      ["Now", "Hackathon build", "Contract v2, the Fleet Vault and the inspector agent on BSC testnet. Owner, renter, dispute-desk and shareholder views. Weekly, two-weekly and monthly rent. AI inspection proposals. Baht-first prices."],
      [
        "Next",
        "Capped BSC mainnet pilot",
        "Not live yet. A small pilot with real USDT, held to limits built into contract v2: at most 0.70 USDT deposit and 0.30 USDT rent per payment per rental (one rental is at most 1 USD), and 5 USDT in all escrows together. Lowering the last limit to zero stops new funding at once; a limit never blocks a payout. No Fleet Vault on mainnet.",
      ],
      ["Q1 2027", "Pilot with real shops", "10 to 20 real scooter rentals with friendly shops in Chiang Mai and Phuket, on testnet funds. An independent security review of the contracts."],
      ["Q2 to Q3 2027", "Mainnet and opBNB", "A real, widely held stablecoin. Wallet onboarding for people new to crypto. Legal review of the escrow and dispute-desk roles under Thai law."],
      ["After that", "Partnerships", "Rental shops, fleet operators and travel platforms. Rental associations and insurers as named arbiters. Other places with the same passport problem."],
    ] as [string, string, string][],
    more: "The full plan, the risks and how we would handle them:",
    business: "business model",
  },
  closing: {
    title: "See a deposit come back on its own.",
    demo: "The demo runs one whole rental: funded, paid out, inspected and settled, with on-chain transactions you can follow. Or rent the box we brought to the stage: pay test money into a real escrow from your phone and watch it settle on the big screen.",
    app: "Open the app and walk through a rental as the owner, the renter or the dispute desk. Or rent the box we brought to the stage: pay test money into a real escrow from your phone and watch it settle on the big screen.",
    playDemo: "Play the live demo",
    mysteryBox: "Rent our Mystery Box",
    openApp: "Open the app",
    github: "Read the code on GitHub",
  },
  footer: {
    label: "Footer",
    about: "Scooter rental deposits and rent, held in escrow on BNB Chain. Built for BNB Bangkok 2026. Open source (MIT), testnet only, no token.",
    tryIt: "Try it",
    build: "Build",
    read: "Read",
    links: {
      demo: "Play the live demo",
      mysteryBox: "Rent our Mystery Box",
      cartoon: "How it works, as a cartoon",
      app: "Open the app",
      tenant: "Renter",
      subscriptions: "Subscriptions",
      landlord: "Fleet owner",
      shareholders: "Shareholders",
      arbiter: "Dispute desk",
      developers: "Developer reference",
      integrations: "Integrations",
      agent: "Inspector agent",
      api: "API",
      architecture: "Architecture",
      github: "GitHub",
      business: "Business model",
      writeup: "CoinMarketCap x Atlas write-up",
      deploy: "Testnet deployment",
      credits: "Photo credits",
    },
  },
};

export type LandingCopy = typeof en;
/** The landing copy in a language: `(await getDictionary()).of(landingCopy)`. */
export const landingCopy = localized(en, zh);
