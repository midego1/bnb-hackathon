import { parseEther, parseUnits } from "viem";
import { TOKEN } from "@/lib/contracts";

/**
 * Pure rules of the live stage demo (lib/server/stage/index.ts): when it is on, how much test money (or, on BSC
 * mainnet, real money) one phone gets, and how THB prices become mUSDT. No I/O, so every rule is unit-tested (tests/stage.test.ts).
 */

export { stageConfig, type StageChainId, type StageConfig } from "./config";
import type { StageConfig } from "./config";

/** tBNB one phone gets: enough gas for ~8 transactions at BSC testnet prices, never more. */
export const DRIP_TBNB = parseEther("0.002");
/** The funder is never drained below this (it also tops up the /demo wallets). */
export const FUNDER_FLOOR = parseEther("0.02");
/** The mUSDT drip covers rent + deposit plus this margin, so a small THB rate move cannot leave the phone short. */
export const MUSDT_MARGIN_BPS = BigInt(1_000);
/** MockUSDT.FAUCET_LIMIT: one faucet call mints at most 10,000 tokens. */
export const MAX_MUSDT_DRIP = parseUnits("10000", TOKEN.decimals);
/** Gas cap per server-signed stage transaction (createLease is ~400k). */
export const MAX_GAS_PER_TX = BigInt(1_000_000);

export class StageError extends Error {
  readonly status: number;
  readonly retryAfterSec?: number;
  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.name = "StageError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** THB -> mUSDT base units, rounded up to the cent (the renter never pays less than the listed THB). */
export function thbToUnits(thb: number, thbPerUsdt: number): bigint {
  if (!(thb > 0) || !(thbPerUsdt > 0)) throw new StageError(500, "The listing price or the exchange rate is not usable.");
  const cents = Math.ceil((thb / thbPerUsdt) * 100 - 1e-9);
  return BigInt(cents) * BigInt(10) ** BigInt(TOKEN.decimals - 2);
}

/**
 * What to send a phone: tBNB up to DRIP_TBNB and mUSDT up to rent + deposit + margin (capped at the faucet limit).
 * Refuses when the funder would drop below FUNDER_FLOOR.
 */
export function dripPlan(input: { bnb: bigint; musdt: bigint; need: bigint; funderBnb: bigint }): { bnb: bigint; musdt: bigint } {
  const bnb = input.bnb >= DRIP_TBNB ? BigInt(0) : DRIP_TBNB - input.bnb;
  const target = input.need + (input.need * MUSDT_MARGIN_BPS) / BigInt(10_000);
  let musdt = input.musdt >= target ? BigInt(0) : target - input.musdt;
  if (musdt > MAX_MUSDT_DRIP) musdt = MAX_MUSDT_DRIP;
  // The faucet call itself costs the funder gas too: keep a margin of one more drip.
  if (input.funderBnb - bnb - DRIP_TBNB < FUNDER_FLOOR) {
    throw new StageError(503, "The test-money wallet is empty right now. Ask the team to refill it, then try again.");
  }
  return { bnb, musdt };
}

/** BSC mainnet (56): the drip is real money, so it only ever sends what one stage rental needs. */
export const MAINNET_DRIP_BNB = parseEther("0.0003"); // ~8 judge transactions at BSC's 0.05-0.1 gwei, with room
export const MAINNET_MAX_USDT_DRIP = parseUnits("1", TOKEN.decimals);
/** The funder stops handing out money below either of these (the presenter refills it). */
export const MAINNET_FUNDER_MIN_USDT = parseUnits("2", TOKEN.decimals);
export const MAINNET_FUNDER_MIN_BNB = parseEther("0.005");

/**
 * What to send a phone on mainnet: BNB up to MAINNET_DRIP_BNB and BSC-USD up to exactly `need` (rent + deposit, no
 * margin: the price is fixed in USDT), never more than 1 USDT. Refuses when the funder is under its floors.
 */
export function mainnetDripPlan(input: { bnb: bigint; usdt: bigint; need: bigint; funderBnb: bigint; funderUsdt: bigint }): { bnb: bigint; usdt: bigint } {
  if (input.need > MAINNET_MAX_USDT_DRIP) throw new StageError(500, "The stage rental costs more than 1 USD; refusing to send real money for it.");
  if (input.funderUsdt < MAINNET_FUNDER_MIN_USDT || input.funderBnb < MAINNET_FUNDER_MIN_BNB) {
    throw new StageError(503, "The demo wallet is out of money for now. Ask the team to refill it, then try again.");
  }
  const bnb = input.bnb >= MAINNET_DRIP_BNB ? BigInt(0) : MAINNET_DRIP_BNB - input.bnb;
  const usdt = input.usdt >= input.need ? BigInt(0) : input.need - input.usdt;
  return { bnb, usdt };
}

/** The presenter code check: open when no code is configured, constant-time-ish compare otherwise. */
export function presenterAllowed(cfg: Pick<StageConfig, "presenterCode">, code: string | undefined): boolean {
  if (!cfg.presenterCode) return true;
  if (!code || code.length !== cfg.presenterCode.length) return false;
  let diff = 0;
  for (let i = 0; i < code.length; i++) diff |= code.charCodeAt(i) ^ cfg.presenterCode.charCodeAt(i);
  return diff === 0;
}

/** A drip claim: one per address, ever (well, for a week). `pending` guards double taps and two tabs. */
export type DripRecord = { state: "pending"; at: number } | { state: "done"; at: number; txs: string[] };
/** A pending drip older than this is treated as failed (the request died) and may be retried. */
export const DRIP_PENDING_MS = 2 * 60_000;

export function dripDecision(cur: DripRecord | undefined, now: number): "claim" | "done" | "pending" {
  if (!cur) return "claim";
  if (cur.state === "done") return "done";
  return now - cur.at > DRIP_PENDING_MS ? "claim" : "pending";
}
