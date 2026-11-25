import { concat, sha256, type Hex } from "viem";

/**
 * Content hashes for off-chain documents. Only these bytes32 values go on-chain; the files themselves
 * stay off-chain (BNB Greenfield or the local fallback store). Uses viem's pure-JS SHA-256 so it also
 * works on plain-http origins where crypto.subtle is unavailable.
 */
export async function hashFile(file: File): Promise<Hex> {
  return sha256(new Uint8Array(await file.arrayBuffer()));
}

export function hashText(text: string): Hex {
  return sha256(new TextEncoder().encode(text));
}

/** One hash for a set of files: SHA-256 over the sorted per-file hashes (order-independent manifest). */
export function manifestHash(hashes: Hex[]): Hex {
  if (hashes.length === 1) return hashes[0];
  return sha256(concat([...hashes].sort()));
}

export const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
