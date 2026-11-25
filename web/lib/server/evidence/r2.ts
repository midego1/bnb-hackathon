import type { Bytes32Hex } from "../hash";
import { sniffContentType, type EvidenceContentType, type EvidenceStore, type StoredEvidence } from "./types";

/** Just enough of an R2Bucket binding for evidence, so this file needs no Workers types. */
export interface R2BucketLike {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

/** Name of the optional R2 bucket binding in web/wrangler.jsonc. */
export const EVIDENCE_BINDING = "EVIDENCE";

/**
 * Cloudflare R2 store, used on Workers when the EVIDENCE bucket is bound (docs/CLOUDFLARE.md). Objects are private
 * (no public bucket URL) and named `evidence/<sha256>`, like on Greenfield; GET /api/evidence/<hash> serves them.
 */
export class R2EvidenceStore implements EvidenceStore {
  readonly name = "r2" as const;

  constructor(private readonly bucket: R2BucketLike) {}

  private key(hash: Bytes32Hex) {
    return `evidence/${hash.slice(2)}`;
  }

  async put(hash: Bytes32Hex, bytes: Uint8Array, contentType: EvidenceContentType): Promise<void> {
    const key = this.key(hash);
    if (await this.bucket.head(key)) return; // content-addressed: already stored
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
  }

  async get(hash: Bytes32Hex): Promise<StoredEvidence | null> {
    const obj = await this.bucket.get(this.key(hash));
    if (!obj) return null;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const contentType = sniffContentType(bytes);
    if (!contentType) return null;
    return { hash, bytes, contentType };
  }
}

export class EvidenceUploadsDisabledError extends Error {
  readonly status = 503;
  constructor() {
    super("evidence uploads are disabled on this deployment");
    this.name = "EvidenceUploadsDisabledError";
  }
}

/**
 * A Worker without the EVIDENCE bucket has no disk to fall back on: uploads are refused with a clear 503 (the
 * browser then hashes the files itself, lib/evidence.ts) and lookups find nothing. The demo's evidence is served as
 * static files from /public/demo, so the demo does not need this store.
 */
export class DisabledEvidenceStore implements EvidenceStore {
  readonly name = "disabled" as const;

  async put(): Promise<void> {
    throw new EvidenceUploadsDisabledError();
  }

  async get(): Promise<StoredEvidence | null> {
    return null;
  }
}
