import type { Env } from "../env";
import { sha256Hex, type Bytes32Hex } from "../hash";
import { cloudflareBinding, onCloudflare } from "../platform";
import { GreenfieldEvidenceStore, greenfieldConfigFromEnv } from "./greenfield";
import { LocalEvidenceStore } from "./local";
import { DisabledEvidenceStore, EVIDENCE_BINDING, R2EvidenceStore, type R2BucketLike } from "./r2";
import { maxEvidenceBytes, sniffContentType, type EvidenceContentType, type EvidenceStore } from "./types";

export * from "./types";
export { LocalEvidenceStore } from "./local";
export { GreenfieldEvidenceStore } from "./greenfield";
export { DisabledEvidenceStore, EvidenceUploadsDisabledError, R2EvidenceStore, type R2BucketLike } from "./r2";

let cached: EvidenceStore | null = null;

/**
 * Node (`next dev` / `next start`): Greenfield when GREENFIELD_* is fully configured, otherwise the local filesystem
 * fallback. Cloudflare Workers have no disk: the EVIDENCE R2 bucket when bound, otherwise uploads are disabled.
 */
export function evidenceStoreFromEnv(env: Env = process.env, platform: { cloudflare: boolean; r2?: R2BucketLike } = { cloudflare: false }): EvidenceStore {
  if (platform.cloudflare) return platform.r2 ? new R2EvidenceStore(platform.r2) : new DisabledEvidenceStore();
  const gf = greenfieldConfigFromEnv(env);
  return gf ? new GreenfieldEvidenceStore(gf) : new LocalEvidenceStore();
}

export function getEvidenceStore(): EvidenceStore {
  // On Workers the bucket binding belongs to the request: build the (stateless) store per call.
  if (onCloudflare()) return evidenceStoreFromEnv(process.env, { cloudflare: true, r2: cloudflareBinding<R2BucketLike>(EVIDENCE_BINDING) });
  cached ??= evidenceStoreFromEnv();
  return cached;
}

export class EvidenceRejectedError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 415 | 400,
  ) {
    super(message);
    this.name = "EvidenceRejectedError";
  }
}

export interface EvidenceRecord {
  hash: Bytes32Hex;
  size: number;
  contentType: EvidenceContentType;
  filename?: string;
  storage: EvidenceStore["name"];
  /** Relative URL that serves the bytes back. */
  url: string;
}

/** Validate, hash and store one file. Throws EvidenceRejectedError on size/type violations. */
export async function storeEvidence(
  store: EvidenceStore,
  bytes: Uint8Array,
  filename?: string,
  maxBytes = maxEvidenceBytes(),
): Promise<EvidenceRecord> {
  if (bytes.byteLength === 0) throw new EvidenceRejectedError(`${filename ?? "file"} is empty`, 400);
  if (bytes.byteLength > maxBytes) {
    throw new EvidenceRejectedError(`${filename ?? "file"} is ${bytes.byteLength} bytes; limit is ${maxBytes}`, 413);
  }
  const contentType = sniffContentType(bytes);
  if (!contentType) {
    throw new EvidenceRejectedError(`${filename ?? "file"} is not a PDF, JPEG, PNG or WebP`, 415);
  }
  const hash = sha256Hex(bytes);
  await store.put(hash, bytes, contentType);
  return { hash, size: bytes.byteLength, contentType, filename, storage: store.name, url: `/api/evidence/${hash}` };
}
