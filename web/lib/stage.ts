import { formatUnits, parseUnits, zeroHash, type Address } from "viem";
import { TOKEN } from "@/lib/contracts";
import type { LeaseSnapshot } from "@/lib/actions/lease";
import type { Translate } from "@/lib/i18n/keys";
import { formatFiat } from "@/lib/fiat";
import { LISTING_THB_PER_USDT, type Listing } from "@/lib/listings";
import type { ChainEvent } from "@/lib/rentals";

/**
 * The live judge demo ("stage"): a judge rents a physical item from their phone (/r/<slug>) while the big screen
 * (/stage/<slug>) follows the rental live. What GET /api/stage/<slug> returns, and the pure rules both screens use to
 * decide what comes next. Every step is derived from chain state, so a reload carries on where it was.
 */

export type StageRental = { lease: Address; renter: Address; createdAt: number };

export type StageStatus = {
  chainId: number;
  listing: Listing;
  owner: Address;
  /** mUSDT units of this listing's rent and deposit at today's rate (what the next rental will ask). */
  price: { rent: bigint; deposit: bigint; thbPerUsdt: number };
  rental?: StageRental;
  /** A rental the owner is creating right now (the createLease transaction is in flight). */
  creating?: { renter: Address; at: number };
  lease?: LeaseSnapshot;
  /** Events of the current rental, oldest first, with tx hashes: the browser fills them from /api/chain/index. */
  events: ChainEvent[];
  /** The test money the server sent to `me`, if any. */
  drip?: { txs: string[]; at: number };
  /** Balances of `?renter=` (the phone's wallet). */
  me?: { address: Address; bnb: bigint; musdt: bigint };
  /** Presenter buttons need a code (STAGE_PRESENTER_CODE is set on the server). */
  presenterLocked: boolean;
};

export type JudgeStep = "wallet" | "money" | "rent" | "fund" | "busy" | "pickup" | "return" | "inspect" | "waiting" | "settled";

/** Status numbers of RentalEscrow.Status by name (LeaseSnapshot carries the name). */
const FINAL = new Set(["Settled", "Cancelled"]);
export const isFinal = (status: string | undefined) => !!status && FINAL.has(status);
export const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** An unfunded offer nobody paid for this long may be replaced by a new renter (someone scanned and walked off). */
export const STALE_OFFER_MS = 5 * 60_000;
/** Below this the guest wallet cannot pay for its ~8 transactions (approve, fund, photos, propose). */
export const MIN_GAS_WEI = BigInt(300_000_000_000_000); // 0.0003 tBNB

/** BSC mainnet (56) runs the stage with real BSC-USD, so everything there stays at most 1 USD. */
export const MAINNET_STAGE_CHAIN_ID = 56;
/**
 * The stage item's price on BSC mainnet, whatever the listing says in THB: one 30-day period of 0.30 rent (the
 * one-time fee is 10 % of it, 0.03) and 0.70 deposit. Exactly the default pilot caps of Deploy.s.sol on 56.
 */
export const MAINNET_STAGE_PRICE = { rent: parseUnits("0.30", TOKEN.decimals), deposit: parseUnits("0.70", TOKEN.decimals) } as const;

/** "฿10 (0.30 USDT)": baht first, the token amount beside it (real money on mainnet). */
export const thbUsdText = (units: bigint, thbPerUsdt: number) => `${thbText(units, thbPerUsdt)} (${Number(formatUnits(units, TOKEN.decimals)).toFixed(2)} ${TOKEN.symbol})`;

/** The item's rent and deposit as the screens show them: the listing's baht, or on BSC mainnet the fixed 1 USD price. */
export function stageTerms(listing: Listing, chainId: number): { rent: string; deposit: string } {
  if (chainId === MAINNET_STAGE_CHAIN_ID && listing.stage) {
    return { rent: thbUsdText(MAINNET_STAGE_PRICE.rent, LISTING_THB_PER_USDT), deposit: thbUsdText(MAINNET_STAGE_PRICE.deposit, LISTING_THB_PER_USDT) };
  }
  return { rent: formatFiat(listing.rentThb, "THB"), deposit: formatFiat(listing.depositThb, "THB") };
}

/** What the phone of `me` should do next. Pure: tests/stage.test.ts walks every state. */
export function judgeStep(s: StageStatus, me: Address | undefined, now = Date.now()): JudgeStep {
  if (!me) return "wallet";
  const l = s.lease;
  if (s.rental && l && same(s.rental.renter, me) && l.status !== "Cancelled") {
    if (l.status === "Created") return "fund";
    if (l.status === "Settled") return "settled";
    if (l.status === "MoveOut" || l.status === "Disputed") return "waiting";
    if (l.checkInHash === zeroHash) return "pickup";
    if (l.checkOutHash === zeroHash) return "return";
    return "inspect";
  }
  if (s.creating && !same(s.creating.renter, me)) return "busy";
  if (s.rental && l && !replaceable(s, now)) return "busy";
  const need = s.price.rent + s.price.deposit;
  if (!s.me || s.me.bnb < MIN_GAS_WEI || s.me.musdt < need) return "money";
  return "rent";
}

/** May a new renter take the item: no rental, a finished one, or an offer left unfunded for STALE_OFFER_MS. */
export function replaceable(s: Pick<StageStatus, "rental" | "lease">, now = Date.now()): boolean {
  if (!s.rental || !s.lease) return true;
  if (isFinal(s.lease.status)) return true;
  return s.lease.status === "Created" && now - s.rental.createdAt > STALE_OFFER_MS;
}

/** The stage timeline in plain words, one line per event of the rental, in the active language (stage.event). */
export function eventLabel(e: ChainEvent, t: Translate): string {
  switch (e.name) {
    case "EvidenceAdded":
      return t(Number(e.args.kind) === 0 ? "stage.event.pickupPhoto" : Number(e.args.kind) === 1 ? "stage.event.returnPhoto" : "stage.event.evidence");
    case "LeaseCreated":
    case "Funded":
    case "SettlementProposed":
    case "Settled":
    case "RentReleased":
    case "ProtocolFeePaid":
    case "DisputeRaised":
    case "Cancelled":
      return t(`stage.event.${e.name}`);
    default:
      return e.name;
  }
}

/** Token base units -> THB at the listing's rate (display only). */
export const unitsToThb = (units: bigint, thbPerUsdt: number) => Number(formatUnits(units, TOKEN.decimals)) * thbPerUsdt;
/** "฿1,201": whole baht, big-screen friendly. */
export const thbText = (units: bigint, thbPerUsdt: number) => `฿${Math.round(unitsToThb(units, thbPerUsdt)).toLocaleString("en-US")}`;
