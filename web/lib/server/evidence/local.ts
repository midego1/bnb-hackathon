import type { Env } from "../env";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bytes32Hex } from "../hash";
import { sniffContentType, type EvidenceContentType, type EvidenceStore, type StoredEvidence } from "./types";

/** Default local fallback directory (gitignored): web/.evidence when run from web/. */
export function defaultEvidenceDir(env: Env = process.env): string {
  return env.EVIDENCE_DIR ? path.resolve(env.EVIDENCE_DIR) : path.join(process.cwd(), ".evidence");
}

/** Filesystem store used when Greenfield is not configured. One file per hash, written atomically. */
export class LocalEvidenceStore implements EvidenceStore {
  readonly name = "local" as const;

  constructor(private readonly dir: string = defaultEvidenceDir()) {}

  private file(hash: Bytes32Hex) {
    // hash is validated as 0x + 64 hex chars before it gets here, so it is safe as a filename.
    return path.join(this.dir, `${hash.slice(2)}.bin`);
  }

  async put(hash: Bytes32Hex, bytes: Uint8Array, _contentType: EvidenceContentType): Promise<void> {
    void _contentType; // type is re-derived from the bytes on read
    const target = this.file(hash);
    if (await exists(target)) return;
    await mkdir(this.dir, { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, target);
  }

  async get(hash: Bytes32Hex): Promise<StoredEvidence | null> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file(hash));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const contentType = sniffContentType(bytes);
    if (!contentType) return null;
    return { hash, bytes: new Uint8Array(bytes), contentType };
  }
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
