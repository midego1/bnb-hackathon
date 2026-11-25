import type { Env } from "../env";
import type { Bytes32Hex } from "../hash";

export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type EvidenceContentType = (typeof ALLOWED_TYPES)[number];

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB per file
export const MAX_FILES_PER_REQUEST = 20;

export interface StoredEvidence {
  hash: Bytes32Hex;
  bytes: Uint8Array;
  contentType: EvidenceContentType;
}

/** Where evidence bytes live. Content-addressed: the sha256 hash is the key. */
export interface EvidenceStore {
  readonly name: "local" | "greenfield" | "r2" | "disabled";
  /** Store bytes under their hash. Idempotent: storing the same bytes twice is a no-op. */
  put(hash: Bytes32Hex, bytes: Uint8Array, contentType: EvidenceContentType): Promise<void>;
  /** Fetch bytes by hash, or null when unknown. */
  get(hash: Bytes32Hex): Promise<StoredEvidence | null>;
}

/** Detect the real file type from magic bytes; the client-declared MIME type is not trusted. */
export function sniffContentType(bytes: Uint8Array): EvidenceContentType | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "application/pdf"; // %PDF-
  }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export function maxEvidenceBytes(env: Env = process.env): number {
  const v = Number(env.EVIDENCE_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_MAX_BYTES;
}
