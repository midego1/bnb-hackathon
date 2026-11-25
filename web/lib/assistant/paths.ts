/**
 * In-app pages Ask AI may open (open_page, follow along, card links). Only fixed paths and a rental page built from a
 * checked address: no query strings, fragments, other origins or `..`. The server checks a path before it sends a
 * `navigate` event and the panel checks it again before it moves the page.
 */
import { getAddress, isAddress } from "viem";

export const STATIC_PAGES: Record<string, string> = {
  "/": "Home",
  "/tenant": "Renter",
  "/landlord": "Fleet owner",
  "/arbiter": "Dispute desk",
  "/backoffice": "Back office",
  "/shareholders": "Shareholders",
  "/how-it-works": "How it works",
  "/developers": "Developers",
  "/integrations": "Integrations",
  "/demo": "Play the demo",
};

const LEASE_RE = /^\/lease\/(0x[0-9a-fA-F]{40})$/;

/** The canonical form of an allowed in-app path, or null. */
export function safeAppPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length > 60) return null;
  const p = path.trim();
  if (Object.prototype.hasOwnProperty.call(STATIC_PAGES, p)) return p;
  const m = LEASE_RE.exec(p);
  if (m && isAddress(m[1], { strict: false })) return `/lease/${getAddress(m[1])}`;
  return null;
}

export const leasePath = (address: string) => safeAppPath(`/lease/${address}`);

/** Short label for a path ("Rental 0x9f1a…3a8e"). */
export function pageLabel(path: string): string {
  const m = LEASE_RE.exec(path);
  if (m) return `Rental ${m[1].slice(0, 6)}…${m[1].slice(-4)}`;
  return STATIC_PAGES[path] ?? path;
}

/** The rental address in view, from a path like /lease/0x…. */
export function leaseInView(path: string | undefined | null): `0x${string}` | undefined {
  const m = path ? LEASE_RE.exec(path.split(/[?#]/)[0]) : null;
  return m && isAddress(m[1], { strict: false }) ? (getAddress(m[1]) as `0x${string}`) : undefined;
}
