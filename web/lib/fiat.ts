import { formatUnits } from "viem";
import { TOKEN } from "./contracts";

/** Shape of GET /api/price (kept in sync with lib/server/price). Safe to import client-side. */
export type Fiat = "USD" | "THB";
export type PricedAsset = "USDT" | "BNB";
export interface PriceResponse {
  rates: Record<PricedAsset, Record<Fiat, number>>;
  source: "atlas" | "cmc" | "mock";
  mock: boolean;
  updatedAt: string;
  fetchedAt: string;
  cached?: boolean;
  warning?: string;
}

const LOCALE: Record<Fiat, string> = { USD: "en-US", THB: "th-TH" };

/** Token amount (bigint base units, or a human number/string) -> plain number of tokens. */
export function toTokenNumber(amount: bigint | number | string, decimals: number = TOKEN.decimals): number {
  if (typeof amount === "bigint") return Number(formatUnits(amount, decimals));
  return typeof amount === "number" ? amount : Number(amount);
}

/** Convert a token amount to fiat with a quote; null when no quote is available yet. */
export function toFiat(
  amount: bigint | number | string,
  asset: PricedAsset,
  fiat: Fiat,
  prices: PriceResponse | null | undefined,
  decimals: number = asset === "BNB" ? 18 : TOKEN.decimals,
): number | null {
  const rate = prices?.rates[asset]?.[fiat];
  if (rate === undefined) return null;
  return toTokenNumber(amount, decimals) * rate;
}

/** Format a fiat value: "฿16,500" / "$500.00". THB is shown without satang for amounts >= 100 and for zero. */
export function formatFiat(value: number, fiat: Fiat): string {
  const digits = fiat === "THB" && (Math.abs(value) >= 100 || value === 0) ? 0 : 2;
  return new Intl.NumberFormat(LOCALE[fiat], {
    style: "currency",
    currency: fiat,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * One-liner for UI labels, e.g. "฿16,500 · $500.00". Returns "" until prices load.
 * Append "(demo rates)" in the UI when `prices.mock` is true.
 */
export function formatTokenInFiat(
  amount: bigint | number | string,
  asset: PricedAsset,
  prices: PriceResponse | null | undefined,
  fiats: Fiat[] = ["THB", "USD"],
  decimals?: number,
): string {
  return fiats
    .map((f) => toFiat(amount, asset, f, prices, decimals))
    .map((v, i) => (v === null ? null : formatFiat(v, fiats[i])))
    .filter((s): s is string => s !== null)
    .join(" · ");
}
