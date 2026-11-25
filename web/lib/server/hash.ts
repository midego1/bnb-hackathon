import { createHash } from "node:crypto";

/** A 0x-prefixed, 32-byte lowercase hex string: drops straight into a Solidity `bytes32`. */
export type Bytes32Hex = `0x${string}`;

export const BYTES32_RE = /^0x[0-9a-f]{64}$/;

/** sha256 of raw bytes as a bytes32-compatible hex string. */
export function sha256Hex(data: Uint8Array | string): Bytes32Hex {
  return `0x${createHash("sha256").update(data).digest("hex")}`;
}

/** Lowercase and validate a user-supplied bytes32 hex string; returns null when malformed. */
export function normalizeBytes32(value: string): Bytes32Hex | null {
  const v = value.trim().toLowerCase();
  const withPrefix = v.startsWith("0x") ? v : `0x${v}`;
  return BYTES32_RE.test(withPrefix) ? (withPrefix as Bytes32Hex) : null;
}

/** JSON with object keys sorted recursively, so equal data always hashes to the same value. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
