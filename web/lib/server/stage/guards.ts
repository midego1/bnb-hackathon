import { parseEther, parseUnits } from "viem";

/**
 * Pure rules of the live stage demo (lib/server/stage/index.ts): when it is on, how much test money one phone gets,
 * and how THB prices become mUSDT. No I/O, so every rule is unit-tested (tests/stage.test.ts).
 */

export { stageConfig, type StageChainId, type StageConfig } from "./config";
import type { StageConfig } from "./config";

/** tBNB one phone gets: enough gas for ~8 transactions at BSC testnet prices, never more. */
export const DRIP_TBNB = parseEther("0.002");
/** The funder is never drained below this (it also tops up the /demo wallets). */
export const FUNDER_FLOOR = parseEther("0.02");
/** The mUSDT drip covers rent + deposit plus this margin, so a small THB rate move cannot leave the phone short. */
export const MUSDT_MARGIN_BPS = BigInt(1_000);
/** MockUSDT.FAUCET_LIMIT: one faucet call mints at most this (6 decimals). */
export const MAX_MUSDT_DRIP = parseUnits("10000", 6);
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
  return BigInt(cents) * BigInt(10_000);
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
