import { formatUnits } from "viem";
import { parseTokenAmount } from "./actions/fields";
import { TOKEN } from "./contracts";

export function shortAddress(a: string | undefined): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function usdtNumber(amount: bigint): number {
  return Number(formatUnits(amount, TOKEN.decimals));
}

export function formatUsdt(amount: bigint): string {
  return usdtNumber(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Parses a user-typed USDT amount; undefined for empty/invalid input. The same parser as the forms' validation. */
export const parseUsdt = (input: string): bigint | undefined => parseTokenAmount(input);

export function formatDate(unixSeconds: bigint | number, lang: "en" | "zh" = "en"): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3d 4h", "12m", "now" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}
