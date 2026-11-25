/**
 * Deposit risk buffer (docs/PRODUCT.md "Risk Engine"). Pure and client-safe: the server feeds it live
 * CoinMarketCap quotes and, when available, a Cournot probability; the UI only renders the result.
 */

export type RiskAsset = "USDT" | "BNB";

/** CoinMarketCap `quote.USD` percent changes (in percent, e.g. -3.2 means -3.2 %). */
export interface VolatilityInput {
  price: number;
  percentChange1h?: number | null;
  percentChange24h?: number | null;
  percentChange7d?: number | null;
  percentChange30d?: number | null;
}

export interface CournotSignal {
  claim: string;
  probability: number;
  /** ISO time of the live call that produced it. */
  at: string;
}

export interface BufferResult {
  asset: RiskAsset;
  /** Estimated daily volatility (fraction, 0.03 = 3 %). */
  dailyVol: number;
  /** Days of price risk the buffer covers (rental length, capped; the health check covers longer rentals). */
  horizonDays: number;
  /** Buffer from CMC volatility alone (fraction). */
  cmcBuffer: number;
  /** Extra buffer from the Cournot probability (fraction). */
  cournotBuffer: number;
  /** cmcBuffer + cournotBuffer, rounded up to a whole percent (fraction). */
  buffer: number;
  tier: "stable" | "moderate" | "high" | "rejected";
  /** Price at which the buffered deposit stops covering the THB amount: the Cournot claim threshold. */
  coverageFloorUsd: number;
  explanation: string[];
}

export const RISK = {
  /** One-sided ~90 % confidence. */
  z: 1.28,
  /** Price risk is priced for at most this many days; longer rentals rely on the on-chain health check / top-up. */
  maxHorizonDays: 30,
  /** Below this the token counts as stable: no buffer. */
  stableThreshold: 0.02,
  /** Above this the token is too volatile to accept as a deposit. */
  rejectThreshold: 0.6,
} as const;

const abs = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.abs(v) / 100 : 0);

/** Daily volatility estimate from CMC's rolling percent changes (no paid OHLCV history needed). */
export function dailyVolatility(v: VolatilityInput): number {
  return Math.max(abs(v.percentChange24h), abs(v.percentChange7d) / Math.sqrt(7), abs(v.percentChange30d) / Math.sqrt(30), abs(v.percentChange1h) * Math.sqrt(24) * 0.5);
}

export function computeBuffer(asset: RiskAsset, v: VolatilityInput, rentalDays: number, cournot?: CournotSignal | null): BufferResult {
  const dailyVol = dailyVolatility(v);
  const horizonDays = Math.max(1, Math.min(Math.round(rentalDays), RISK.maxHorizonDays));
  const move = RISK.z * dailyVol * Math.sqrt(horizonDays);
  const explanation = [
    `${asset} daily volatility ≈ ${pct(dailyVol, 2)} (largest of CMC 24h, 7d/√7, 30d/√30 changes).`,
    `Expected adverse move over ${horizonDays} day${horizonDays === 1 ? "" : "s"} at ~90 % confidence: ${pct(move, 1)}.`,
  ];
  let cmcBuffer = move < RISK.stableThreshold ? 0 : move;
  if (cmcBuffer === 0) explanation.push(`Below ${pct(RISK.stableThreshold, 0)}: treated as a stablecoin, no buffer.`);
  const p = cournot && Number.isFinite(cournot.probability) ? Math.min(Math.max(cournot.probability, 0), 1) : null;
  // Cournot answers "will the price fall through the buffer before the return date?": scale the buffer by (1 + p).
  const cournotBuffer = cmcBuffer > 0 && p !== null ? cmcBuffer * p : 0;
  if (p !== null && cmcBuffer > 0) explanation.push(`Cournot puts ${pct(p, 1)} on the price breaking that floor: buffer × (1 + ${p.toFixed(3)}).`);
  const raw = cmcBuffer + cournotBuffer;
  const buffer = raw === 0 ? 0 : Math.ceil(raw * 100) / 100;
  const tier: BufferResult["tier"] = buffer === 0 ? "stable" : buffer > RISK.rejectThreshold ? "rejected" : buffer > 0.25 ? "high" : "moderate";
  if (tier === "rejected") explanation.push(`Above ${pct(RISK.rejectThreshold, 0)}: too volatile to hold a deposit in; pay in USDT instead.`);
  cmcBuffer = round4(cmcBuffer);
  return {
    asset,
    dailyVol: round4(dailyVol),
    horizonDays,
    cmcBuffer,
    cournotBuffer: round4(cournotBuffer),
    buffer,
    tier,
    coverageFloorUsd: v.price / (1 + (cmcBuffer || 0)),
    explanation,
  };
}

/** THB deposit -> amount the renter locks when paying in `asset`, buffer included. */
export function bufferedDeposit(depositThb: number, thbPerToken: number, buffer: number) {
  const thb = depositThb * (1 + buffer);
  return { thb, tokens: thb / thbPerToken };
}

function pct(f: number, digits: number) {
  return `${(f * 100).toFixed(digits)} %`;
}
function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

/** Response of GET /api/risk (shared by server and client). */
export interface RiskResponse {
  cmc:
    | { configured: false; reason: string }
    | { configured: true; ok: false; error: string; fetchedAt: string }
    | {
        configured: true;
        ok: true;
        fetchedAt: string;
        cached: boolean;
        quotes: Record<RiskAsset, { usd: number; thb: number; percentChange24h: number | null; percentChange7d: number | null; percentChange30d: number | null; lastUpdated: string }>;
      };
  /** CMC /v2/tools/price-conversion of the requested THB deposit into USDT and BNB. */
  conversion?: { amountThb: number; usdt: number; bnb: number; lastUpdated: string } | null;
  rentalDays: number;
  depositThb: number;
  options?: Record<RiskAsset, BufferResult & { depositThb: number; depositTokens: number }>;
  cournot: CournotView;
}

export interface CournotView {
  configured: boolean;
  /** Live-call status: "enabled" = server may call (COURNOT_LIVE=1); otherwise cached results only. */
  live: "enabled" | "disabled";
  claim: string | null;
  result: CournotStoredResult | null;
}

/** A Cournot answer as stored by the server (sanitized; never contains IPs or keys). */
export interface CournotStoredResult {
  claim: string;
  marketId: string | null;
  marketTitle: string | null;
  probability: number;
  /** `data.result` fields as returned (point_estimate, interval, …). */
  result: Record<string, unknown> | null;
  /** `basis` exactly as returned: the evidence. */
  basis: unknown;
  billing: unknown;
  at: string;
  /** Request correlation: response header id if any, else our own id. */
  requestId: string;
  source: "live" | "cache";
}
