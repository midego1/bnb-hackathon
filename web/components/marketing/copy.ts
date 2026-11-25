import { localized } from "@/lib/i18n/locales";
import { ARBITER_DAYS, baht, EXAMPLE, FEE_PERCENT, FLEET_OPERATOR_FEE_PERCENT, INSPECTOR_AGENT, OWNER_RESPONSE_DAYS, TESTNET_CONTRACTS } from "@/lib/marketing";
import { zh } from "./copy.zh";

/**
 * Every word of the marketing page at /, in English; Chinese in copy.zh.ts. The facts (amounts, days, addresses)
 * come from lib/marketing.ts. A string array is lines (headline breaks) or, for rich text, the parts around a link or
 * code span. Headlines (`title`, `h1`, the h3s) get the Chinese line in EN+中文; the rest stays English there.
 */
const en = {
  meta: {
    title: "KeyEscrow: rent a scooter in Thailand without leaving your passport",
    description:
      "The deposit for a scooter rental sits in a smart contract on BNB Chain instead of a passport at the counter. An AI inspection proposes the split at return, both sides agree or a dispute desk rules, and deadlines protect the renter. Live on BSC testnet.",
    cardAlt: "KeyEscrow: rent the scooter, keep your passport. An LED picture of a scooter rental shop on a Thai street at night.",
  },
  header: {
    nav: [
      ["#how", "How it works"],
      ["#inspection", "AI inspection"],
      ["#fleet", "Fleet Vault"],
      ["#agents", "For agents"],
      ["#fee", "Fee"],
    ] as [string, string][],
    home: "KeyEscrow, home",
    openApp: "Open the app",
  },
  hero: {
    label: "KeyEscrow in one screen",
    artAlt:
      "LED dot-matrix picture of a Thai street at night: a red scooter parked in front of a lit scooter rental shop, a palm tree, power lines and a temple spire.",
    h1: ["Rent the scooter.", "Keep your passport."],
    body: "In Thailand the deposit for a scooter is usually your passport or a stack of cash, left with a stranger. KeyEscrow puts the deposit in a smart contract on BNB Chain instead. Neither side can move it alone.",
    playDemo: "Play the live demo",
    openApp: "Open the app",
    how: "How it works",
    testnet: "Running on BSC testnet with test money",
    testnetMore: ". Open source, no token",
    facts: [
      ["The deposit", `${baht(EXAMPLE.deposit)}, held by this rental's own contract`],
      ["Your passport", "Stays in your pocket"],
      ["Who can move the money", "Owner and renter together, or the dispute desk"],
    ] as [string, string][],
    example: `Example: a ${EXAMPLE.scooter} at ${baht(EXAMPLE.rent)} a month with a two-month deposit, at an illustrative 1 USDT = 34 THB. The app shows the live rate.`,
  },
  counter: {
    title: "The same counter, with nobody holding your passport.",
    lead: "Renters fear bogus damage claims. Shop owners face real damage with no proof. Neither has anyone neutral to turn to, and nobody goes to court over a few thousand baht.",
    today: "Today",
    ours: "With KeyEscrow",
    rows: [
      ["The deposit", "Your passport or cash, in the shop's drawer", "Tokens in a contract made for this one rental"],
      ["Proof of the scooter's condition", "A few chat photos, if any", "Guided pickup and return photos, their fingerprints stored on-chain"],
      ["At return", "Whoever holds the passport wins the argument", "An AI inspection proposes a split; both sides accept, or the dispute desk rules"],
      ["If the other side goes quiet", "You wait, or you fly home without it", `After ${OWNER_RESPONSE_DAYS} days of silence the full deposit goes back to the renter`],
    ] as [string, string, string][],
  },
  how: {
    title: "How it works, in four steps.",
    cartoon: "Watch it as a one-minute cartoon",
    steps: [
      {
        title: "The shop offers the scooter",
        body: "Rent, deposit and rental period, priced in baht. The rental agreement and guided pickup photos stay off-chain; only their SHA-256 fingerprints go on-chain.",
        money: [
          ["In escrow", baht(0)],
          ["Passport", "with the renter"],
        ],
      },
      {
        title: "The renter funds the escrow",
        body: "The deposit and the first month's rent go into this rental's own contract, instead of a passport at the counter.",
        money: [
          ["In escrow", baht(EXAMPLE.funded)],
          ["of which deposit", baht(EXAMPLE.deposit)],
        ],
      },
      {
        title: "Ride. Rent is paid out monthly",
        body: "Rent is released to the owner on a fixed 30-day schedule. KeyEscrow's fee comes out of the first payout only, never out of the deposit.",
        money: [
          ["Owner, month 1", baht(EXAMPLE.firstPayout)],
          ["Still in escrow", baht(EXAMPLE.deposit)],
        ],
      },
      {
        title: "Return the scooter, settle in minutes",
        body: "An AI inspection compares pickup and return photos and proposes a split of the deposit. One side proposes, the other accepts, and the money moves at once.",
        money: [
          ["Back to the renter", baht(EXAMPLE.deposit)],
          ["In escrow", baht(0)],
        ],
      },
    ] as { title: string; body: string; money: [string, string][] }[],
    note: `The money column follows the example rental: a ${EXAMPLE.scooter} at ${baht(EXAMPLE.rent)} a month, a ${baht(EXAMPLE.deposit)} deposit and the one-time ${baht(EXAMPLE.fee)} fee, at an illustrative 1 USDT = 34 THB, returned with no new damage. On testnet the token is mUSDT, a test stablecoin.`,
  },
  inspection: {
    title: "The AI proposes. People decide.",
    lead: "At return, a vision model compares the pickup photos with the return photos and proposes how to split the deposit, with its reasons. It cannot move a single baht.",
    points: [
      ["Bounded.", "The refund and the claim always add up to the deposit, and never more."],
      ["Two signatures.", "One side submits the proposal on-chain, the other accepts. Either can dispute it instead."],
      ["Signed.", `Reports are signed by the KeyEscrow Inspector, ERC-8004 agent #${INSPECTOR_AGENT.id} on BSC testnet, so anyone can check who wrote them.`],
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
      "The demo's illustrated photo set and an example proposal on a 200 mUSDT deposit. The contracts say tenant and landlord where this page says renter and owner.",
  },
  deadlines: {
    title: "Every dispute has a deadline.",
    lead: "The KeyEscrow dispute desk is the default arbiter; an owner can name another neutral one, and the renter sees who it is before paying. Whoever it is, the clock protects the renter.",
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
  fleet: {
    title: "Fleet Vault: one fleet, many owners.",
    lead: "A shop can point a scooter's income at a vault instead of its own wallet. Rent and damage payouts land in the vault and are shared among whoever holds its shares. A testnet prototype.",
    owners: "For shop owners",
    ownersBody: `List a scooter with the vault as its payee. You keep every role in the rental (propose, accept, dispute); only the payouts go to the vault. The operator keeps ${FLEET_OPERATOR_FEE_PERCENT}% of income for maintenance.`,
    ownersLink: "Open the fleet owner view",
    holders: "For shareholders",
    holdersBody:
      "Deposit mUSDT and receive BKK-FLEET-1 shares one to one. Claim your share of the fleet's income whenever you like, or redeem the shares for your deposit.",
    holdersLink: "Open the shareholder view",
    splitLabel: (rest: number) => `Of every baht of vault income, ${FLEET_OPERATOR_FEE_PERCENT}% goes to the operator and ${rest}% to shareholders.`,
    operator: `${FLEET_OPERATOR_FEE_PERCENT}% operator`,
    toHolders: (rest: number) => `${rest}% to shareholders, pro rata`,
    caption: `Where vault income goes: ${FLEET_OPERATOR_FEE_PERCENT}% to the operator for maintenance, the rest to shareholders. Revenue-sharing tokens can be securities; compliant issuance and resale of shares are next steps, and this prototype does neither.`,
  },
  agents: {
    title: "Built for agents, not only for browsers.",
    lead: [
      "Every rental action is defined once and served three ways: a REST endpoint, an MCP tool and an A2A skill. The ",
      " actions return unsigned transactions, already simulated on the chain, for your own wallet to sign. KeyEscrow never holds a key.",
    ],
    inspector: [`The inspector is an agent too: ERC-8004 agent #${INSPECTOR_AGENT.id} in the Identity Registry on BSC testnet (`, "registration", "). Other agents can find it, call it and verify what it signed."],
    developers: "Developer reference",
    docs: "Agent docs",
    codeLabel: "Connect Claude Code to the local KeyEscrow MCP server",
    code: `# the agent, from a checkout of the repo
pnpm agent:dev

# then, in Claude Code
claude mcp add --transport http keyescrow \\
  http://127.0.0.1:8790/mcp`,
    tools: (rental: number, inspector: number) => `${rental} rental tools and ${inspector} inspector tools`,
  },
  live: {
    title: "Live on BSC testnet. Check it yourself.",
    lead: "The contracts are deployed on BSC testnet (chain 97) and their source is verified (an exact match on Sourcify), so what runs is what is in the repo. They are small and non-upgradeable. Nobody holds an admin key over a rental's funds: the money can only go to the two parties named at creation, and the dispute desk can only rule on a rental that is in dispute. Test money only: there is no mainnet deployment yet.",
    caption: "KeyEscrow contracts on BSC testnet",
    cols: ["Contract", "What it does", "Address (BscScan testnet)"],
    roles: Object.fromEntries(TESTNET_CONTRACTS.map((c) => [c.name, c.role as string])) as Record<(typeof TESTNET_CONTRACTS)[number]["name"], string>,
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
  fee: {
    title: `${FEE_PERCENT}% of one month's rent. Once.`,
    body: "Paid by the owner out of the first rent payout, however long the rental runs. Never taken from the deposit: that is the renter's money until the rental is settled. The renter pays nothing extra, and there is no token.",
    caption: `A ${EXAMPLE.scooter} rented by the month, in baht`,
    rows: [
      "Monthly rent",
      "Deposit, two months, instead of the passport",
      "Renter pays in at pickup: deposit and month 1",
      "KeyEscrow fee, once",
      "Owner receives for month 1",
      "Owner receives for each later month",
    ],
    note: "Illustrative rate of 1 USDT = 34 THB. Over a three-month rental the fee is about 3% of the rent. The rate is capped in the factory contract, and each rental keeps the rate it was created with.",
  },
  roadmap: {
    title: "Where this goes next.",
    lead: "Today KeyEscrow is a working testnet build, not a business with customers. This is the plan from here.",
    phases: [
      ["Now", "Hackathon build", "Escrow, vault and inspector agent on BSC testnet. Owner, renter and dispute-desk flows. AI inspection proposals. Baht-first prices."],
      ["Q1 2027", "Testnet pilot", "10 to 20 real scooter rentals with friendly shops in Chiang Mai and Phuket, on testnet funds. An independent security review of the contracts."],
      ["Q2 to Q3 2027", "Mainnet and opBNB", "A real, widely held stablecoin. Wallet onboarding for people new to crypto. Legal review of the escrow and dispute-desk roles under Thai law."],
      ["After that", "Partnerships", "Rental shops, fleet operators and travel platforms. Rental associations as named arbiters. Other places with the same passport problem."],
    ] as [string, string, string][],
    more: "The full plan, the risks and how we would handle them:",
    business: "business model",
  },
  closing: {
    title: "See a deposit come back on its own.",
    demo: "The demo runs one whole rental: funded, paid out, inspected by AI and settled, with on-chain transactions you can follow.",
    app: "Open the app and walk through a rental as the owner, the renter or the dispute desk.",
    playDemo: "Play the live demo",
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
      cartoon: "How it works, as a cartoon",
      app: "Open the app",
      tenant: "Renter",
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
    },
  },
};

export type LandingCopy = typeof en;
/** The landing copy in a language: `(await getDictionary()).of(landingCopy)`. */
export const landingCopy = localized(en, zh);
