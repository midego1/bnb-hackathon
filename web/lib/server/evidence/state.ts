import type { Bytes32Hex } from "../hash";
import { update, type SharedState } from "../state";
import { sniffContentType, type EvidenceContentType, type EvidenceStore, type StoredEvidence } from "./types";

/** Small photos only: the stage demo's phone photos are compressed to <= 200 KB in the browser. */
export const STATE_EVIDENCE_MAX_BYTES = 256 * 1024;
/** At most this many files live at once (~128 MB at the size cap, far under a Durable Object's storage). */
export const STATE_EVIDENCE_MAX_FILES = 500;
/** Every file expires after a week. */
export const STATE_EVIDENCE_TTL_MS = 7 * 86_400_000;

const INDEX = "evidence:index";
const key = (hash: Bytes32Hex) => `evidence:${hash.slice(2)}`;

export class EvidenceStoreFullError extends Error {
  readonly status = 507;
  constructor(message: string) {
    super(message);
    this.name = "EvidenceStoreFullError";
  }
}

/**
 * Evidence in SharedState: the KeyEscrowState Durable Object on a Worker with no R2 bucket (and a Map in tests). For
 * the stage demo's small photos: capped in size and count, each expiring after STATE_EVIDENCE_TTL_MS.
 * `state` is called per operation: a Durable Object stub must not outlive its request.
 */
export class StateEvidenceStore implements EvidenceStore {
  readonly name = "state" as const;

  constructor(
    private readonly state: () => SharedState,
    private readonly now: () => number = Date.now,
  ) {}

  async put(hash: Bytes32Hex, bytes: Uint8Array, contentType: EvidenceContentType): Promise<void> {
    if (bytes.byteLength > STATE_EVIDENCE_MAX_BYTES) {
      throw new EvidenceStoreFullError(`files on this server are limited to ${STATE_EVIDENCE_MAX_BYTES / 1024} KB; compress the photo first`);
    }
    const s = this.state();
    if (await s.get(key(hash))) return; // content-addressed: already stored
    const now = this.now();
    // Reserve a slot in the index first, so the count cap holds under concurrent uploads.
    const ok = await update<[string, number][], boolean>(s, INDEX, (cur) => {
      const live = (cur ?? []).filter(([, exp]) => exp > now);
      if (live.some(([h]) => h === hash)) return { result: true };
      if (live.length >= STATE_EVIDENCE_MAX_FILES) return { result: false };
      return { value: [...live, [hash, now + STATE_EVIDENCE_TTL_MS]], ttlMs: STATE_EVIDENCE_TTL_MS, result: true };
    });
    if (!ok) throw new EvidenceStoreFullError("evidence storage on this server is full; try again later");
    await s.set(key(hash), 0, { bytes, contentType }, { ttlMs: STATE_EVIDENCE_TTL_MS });
  }

  async get(hash: Bytes32Hex): Promise<StoredEvidence | null> {
    const v = (await this.state().get<{ bytes: Uint8Array }>(key(hash)))?.value;
    if (!v) return null;
    const bytes = new Uint8Array(v.bytes);
    const contentType = sniffContentType(bytes);
    return contentType ? { hash, bytes, contentType } : null;
  }
}
