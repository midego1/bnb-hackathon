/**
 * Facts the marketing page at / states. Everything here exists in the repo; tests/marketing.test.ts compares the
 * addresses and the agent id with contracts/deployments/97.json and agent/deployments/97.json, the fee and the
 * timeouts with the contracts, and the tool names with lib/actions/definitions.ts.
 */
import deployments from "@/lib/contracts/deployments.generated.json";
import { REPO_URL } from "@/lib/links";
import { LISTING_CITIES, LISTINGS, type Listing } from "@/lib/listings";

const EXPLORER = "https://testnet.bscscan.com";
const bsc = deployments["97"];

export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}#code`;
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;

/** BSC testnet (chain 97). All four are source-verified (exact match on Sourcify; `pnpm deploy:testnet:verify`). */
export const TESTNET_CONTRACTS = [
  { name: "EscrowFactory", role: "Creates one escrow per rental and holds the fee setting", address: bsc.escrowFactory },
  { name: "RentalEscrow", role: "The implementation every rental's escrow is a minimal clone of", address: bsc.rentalEscrowImplementation },
  { name: "FleetVault", role: "BKK-FLEET-1 shares: fleet income, shared pro rata", address: bsc.fleetVault },
  { name: "MockUSDT", role: "Test stablecoin (mUSDT, 6 decimals) standing in for USDT", address: bsc.mockUsdt },
] as const;

/** The AI inspector's on-chain identity (ERC-8004 Identity Registry on BSC testnet). */
export const INSPECTOR_AGENT = {
  id: "2921",
  registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  registerTx: "0x40c7cf2008857eabb197df1453e33b3b45760fdec8e7f846ac23a4c2e73328c0",
} as const;

/** `forge test` in contracts/ (unit, fuzz, invariants), as the README's test section states it. */
export const CONTRACT_TESTS = 314;
export const TESTS_URL = `${REPO_URL}/tree/main/contracts/test`;

/** Protocol fee and default deadlines, as deployed (EscrowFactory: feeBps, DEFAULT_RESPONSE_WINDOW, DEFAULT_ARBITER_WINDOW). */
export const FEE_PERCENT = 10;
export const OWNER_RESPONSE_DAYS = 7;
export const ARBITER_DAYS = 14;
/** FleetVault operator (maintenance) fee as deployed, in percent of income. */
export const FLEET_OPERATOR_FEE_PERCENT = 10;

/** The rent rhythms contract v2 accepts (EscrowFactory: a rentPeriod of 7, 14 or 30 days). */
export const RENT_PERIOD_DAYS = [7, 14, 30] as const;
/** One payment of the example scooter at a rhythm: the monthly price x days / 30, rounded down (lib/fleet.ts). */
export const rentPer = (days: number) => Math.floor((EXAMPLE.rent * days) / 30);

/** The inspector's own MCP tools (agent/src/mcp.ts); the rental actions come from lib/actions/definitions.ts. */
export const INSPECTOR_TOOLS = ["inspect_move_out", "verify_report", "inspector_identity"] as const;

/**
 * The worked example from docs/BUSINESS.md: a Honda Click 125i by the month, at an illustrative 1 USDT = 34 THB.
 * Amounts in baht. `claim` and `refund` are the damage ending: the example proposal of 30 of 200 mUSDT to the owner.
 */
export const EXAMPLE = {
  scooter: "Honda Click 125i",
  rent: 3400,
  deposit: 6800,
  funded: 10200,
  fee: 340,
  firstPayout: 3060,
  claim: 1020,
  refund: 5780,
} as const;

export const baht = (n: number) => `฿${n.toLocaleString("en-US")}`;

/** How long a visitor wants a scooter for: it picks the price a listing card leads with. */
export const RENT_LENGTHS = ["day", "week", "month"] as const;
export type RentLength = (typeof RENT_LENGTHS)[number];
/** The landing page's search: a city (none = everywhere), a start date (only echoed: every demo listing is open on every date) and a length. */
export type ListingSearch = { where?: (typeof LISTING_CITIES)[number]; when?: string; how: RentLength };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The search in the page's query string. Anything unknown falls back: everywhere, any date, by the day. */
export function parseSearch(query: Record<string, string | string[] | undefined>): ListingSearch {
  const where = one(query.where).trim().toLowerCase();
  const when = one(query.when);
  const how = one(query.how);
  return {
    where: LISTING_CITIES.find((c) => c.toLowerCase() === where),
    when: /^\d{4}-\d{2}-\d{2}$/.test(when) && !Number.isNaN(Date.parse(when)) ? when : undefined,
    how: RENT_LENGTHS.find((l) => l === how) ?? "day",
  };
}

/** The listings a search shows: all of them, or one city's. */
export const searchListings = (search: ListingSearch, all: Listing[] = LISTINGS) => (search.where ? all.filter((l) => l.city === search.where) : all);

/**
 * What a listing costs for a length: per day, per week (the monthly price x 7 / 30, rounded down, as subscriptions
 * do) or per month. A listing without a monthly price only rents by the day.
 */
export function listingPrice(l: Pick<Listing, "rentThb" | "monthThb">, how: RentLength): { amount: number; per: RentLength } {
  if (how === "day" || l.monthThb === undefined) return { amount: l.rentThb, per: "day" };
  return how === "month" ? { amount: l.monthThb, per: "month" } : { amount: Math.floor((l.monthThb * 7) / 30), per: "week" };
}
