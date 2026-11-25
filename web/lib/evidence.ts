import type { Hex } from "viem";
import { hashFile } from "./hash";

export type UploadedFile = {
  hash: Hex;
  filename: string;
  size: number;
  /** Where the file can be fetched back (undefined when only hashed in the browser). */
  url?: string;
  storage: string;
};

/**
 * Uploads rental agreements / photos to POST /api/evidence (BNB Greenfield, or the server's local fallback)
 * and returns their sha256 content hashes, the bytes32 values that go on-chain. If the upload fails the file
 * is still hashed in the browser so the flow can continue; the result then says `storage: "browser"`.
 */
export async function uploadEvidence(files: File[]): Promise<{ items: UploadedFile[]; warning?: string }> {
  if (files.length === 0) return { items: [] };
  try {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch("/api/evidence", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `upload failed (${res.status})`);
    return {
      items: (body.items as UploadedFile[]).map((i) => ({ ...i, hash: i.hash.toLowerCase() as Hex })),
      warning: body.mock ? "Stored on the server's local disk (Greenfield not configured)." : undefined,
    };
  } catch (err) {
    const items = await Promise.all(
      files.map(async (f) => ({ hash: await hashFile(f), filename: f.name, size: f.size, storage: "browser" })),
    );
    return { items, warning: `Upload failed (${(err as Error).message}); only the hash was computed in your browser.` };
  }
}

export function evidenceUrl(hash: string) {
  return `/api/evidence/${hash}`;
}
