import { LeaseStatus } from "./contracts";

/**
 * "Pay with PromptPay" DEMO: a PromptPay-style QR (EMVCo merchant-presented payload) built locally, and the amount math.
 * No payment provider, no real money: the QR names a fake all-zero proxy id that no bank account can have, and paying
 * is simulated by the server minting test mUSDT (lib/server/onramp.ts). Pure, safe to import client- and server-side.
 */

/** Fake PromptPay proxy (tax-id style, 13 digits): all zeros, never a real person or merchant. */
export const DEMO_PROXY_ID = "0000000000000";
/** How long a generated QR stays valid on the page (a real PromptPay QR from a partner expires too). */
export const QR_TTL_MS = 10 * 60_000;

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), the checksum EMVCo QR payloads end with, as 4 upper-case hex digits. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** EMVCo payload of a one-time PromptPay QR for `thb` baht to the demo proxy id. */
export function promptPayPayload(thb: number): string {
  if (!Number.isFinite(thb) || thb <= 0) throw new Error("PromptPay amount must be a positive number of baht.");
  const body =
    tlv("00", "01") + // payload format
    tlv("01", "12") + // dynamic QR (one payment, amount fixed)
    tlv("29", tlv("00", "A000000677010111") + tlv("02", DEMO_PROXY_ID)) + // PromptPay AID + proxy (tax id slot)
    tlv("53", "764") + // THB
    tlv("54", thb.toFixed(2)) +
    tlv("58", "TH") +
    "6304";
  return body + crc16(body);
}

/** Baht to pay for `amount` mUSDT (6 decimals) at `thbPerUsdt`, rounded to the satang. */
export function thbFor(amount: bigint, thbPerUsdt: number): number {
  return Math.round((Number(amount) / 1e6) * thbPerUsdt * 100) / 100;
}

/**
 * What the renter owes right now, in mUSDT base units: deposit + first month while the rental awaits funding, one
 * month's rent while it runs and months are left to pay in. Undefined otherwise (nothing to pay with PromptPay).
 */
export function amountDue(l: {
  status: number;
  terms: { depositAmount: bigint; rentAmount: bigint; termMonths: number };
  monthsFunded: number;
}): { amount: bigint; what: "fund" | "rent" } | undefined {
  if (l.status === LeaseStatus.Created) return { amount: l.terms.depositAmount + l.terms.rentAmount, what: "fund" };
  if (l.status === LeaseStatus.Active && l.monthsFunded < l.terms.termMonths) return { amount: l.terms.rentAmount, what: "rent" };
  return undefined;
}
