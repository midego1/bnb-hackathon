import { localized } from "@/lib/i18n/locales";
import { zh } from "./copy.zh";

/** Every word of /sponsors (app/(app)/sponsors/page.tsx); the links and states live in the page. */
const en = {
  metaTitle: "Sponsor tracks · KeyScrow",
  title: "Sponsor tracks",
  lead: "What KeyScrow enters at BNB Bangkok 2026, what each track uses, and its state on this server right now. The status chips read the same data as /api/integrations.",
  see: "See it",
  proof: "Proof",
  state: { live: "Live", built: "Built", waiting: "Waiting for key" },
  tracks: {
    bnb: {
      name: "Developer Track (BNB Chain)",
      body: "Every rental gets its own escrow contract on BSC testnet (plus a capped mainnet pilot, max 1 USD a rental); the AI inspector is ERC-8004 agent #2921 and every action is REST, MCP and A2A, with a judge demo and an iOS app.",
    },
    cmcAtlas: {
      name: "CoinMarketCap x Atlas",
      body: "CoinMarketCap prices every amount in baht (USD/THB) and its volatility sets the deposit buffer; the Atlas pull oracle on BSC testnet is being wired as the on-chain price check.",
      cmc: "CoinMarketCap Pro API: USD/THB and the deposit volatility buffer",
      atlas: "Atlas pull oracle on BSC testnet (being wired)",
    },
    livingBrain: {
      name: "ChatAndBuild / Living Brain",
      body: "The AI inspector remembers each scooter's damage history and each wallet's dispute history, so old scratches are never charged twice and the dispute desk sees who it is dealing with; the demo world's shops and renters come with histories.",
    },
    cournot: {
      name: "Cournot",
      body: "Built: a prediction-market probability that BNB falls below a threshold before the return date raises the deposit buffer, with the exact claim and evidence shown; it waits for a partner key before it makes live calls.",
    },
    aws: {
      name: "AWS startup pitch",
      body: "A business with a fee from day one (10% of one month's rent, once per rental, never from the deposit) and a roadmap from a testnet pilot with Thai shops to mainnet, asset pools, opBNB and native apps.",
    },
  },
  links: {
    duo: "Split screen: renter phone + rental company",
    stage: "Judge demo on a big screen",
    phone: "Judge demo on your phone",
    demo: "One-click live demo",
    app: "The app",
    developers: "REST, MCP and OpenAPI",
    agentCard: "Agent card (ERC-8004 #2921)",
    factory: "Escrow factory on BscScan (testnet)",
    registration: "ERC-8004 registration tx",
    mainnet: "Mainnet pilot site",
    mainnetFactory: "Mainnet factory on BscScan",
    ios: "iOS app source",
    integrations: "Integrations and call log",
    integrationsApi: "/api/integrations (raw state)",
    price: "/api/price (current rate source)",
    writeup: "CoinMarketCap x Atlas write-up",
    sponsorsDoc: "Sponsor requirements",
    arbiter: "Dispute desk with history cards",
    backoffice: "Back office: demo shops",
    memoryDoc: "How dispute memory works",
    cournotDoc: "Cournot integration (README)",
    pitch: "The 3-minute pitch",
    business: "Business model",
    roadmap: "Roadmap",
  },
  notEntered: {
    title: "Not entered",
    body: "Four.meme / OpenFour: there is no testnet and KeyScrow has no token of its own. Flap: not entered.",
  },
};

export type SponsorsCopy = typeof en;
export const sponsorsCopy = localized(en, zh);
