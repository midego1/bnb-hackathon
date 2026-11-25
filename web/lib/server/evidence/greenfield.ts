import type { Env } from "../env";
import type { Bytes32Hex } from "../hash";
import { sniffContentType, type EvidenceContentType, type EvidenceStore, type StoredEvidence } from "./types";

export interface GreenfieldConfig {
  rpcUrl: string;
  chainId: string;
  bucket: string;
  /** Hex private key of the account that owns the bucket. Server-side only. */
  privateKey: string;
  /** Optional storage-provider endpoint; the SDK picks one from the bucket when omitted. */
  spEndpoint?: string;
}

/** Returns a config only when every required GREENFIELD_* variable is set. */
export function greenfieldConfigFromEnv(env: Env = process.env): GreenfieldConfig | null {
  const { GREENFIELD_RPC_URL, GREENFIELD_CHAIN_ID, GREENFIELD_BUCKET, GREENFIELD_PRIVATE_KEY, GREENFIELD_SP_ENDPOINT } = env;
  if (!GREENFIELD_RPC_URL || !GREENFIELD_CHAIN_ID || !GREENFIELD_BUCKET || !GREENFIELD_PRIVATE_KEY) return null;
  return {
    rpcUrl: GREENFIELD_RPC_URL,
    chainId: GREENFIELD_CHAIN_ID,
    bucket: GREENFIELD_BUCKET,
    privateKey: GREENFIELD_PRIVATE_KEY,
    spEndpoint: GREENFIELD_SP_ENDPOINT || undefined,
  };
}

type GreenfieldClient = import("@bnb-chain/greenfield-js-sdk").Client;

/**
 * BNB Greenfield store via the official SDK. Objects are private and named `evidence/<sha256>`;
 * the app serves them back through GET /api/evidence/<hash>. The SDK is loaded lazily so the
 * local fallback never pays for it.
 */
export class GreenfieldEvidenceStore implements EvidenceStore {
  readonly name = "greenfield" as const;
  private clientPromise: Promise<GreenfieldClient> | null = null;

  constructor(private readonly cfg: GreenfieldConfig) {}

  private client() {
    this.clientPromise ??= import("@bnb-chain/greenfield-js-sdk").then(({ Client }) =>
      Client.create(this.cfg.rpcUrl, this.cfg.chainId),
    );
    return this.clientPromise;
  }

  private objectName(hash: Bytes32Hex) {
    return `evidence/${hash.slice(2)}`;
  }

  private auth() {
    return { type: "ECDSA" as const, privateKey: this.cfg.privateKey };
  }

  async put(hash: Bytes32Hex, bytes: Uint8Array, contentType: EvidenceContentType): Promise<void> {
    const client = await this.client();
    const { VisibilityType } = await import("@bnb-chain/greenfield-js-sdk");
    const objectName = this.objectName(hash);
    try {
      await client.object.headObject(this.cfg.bucket, objectName);
      return; // content-addressed: already stored
    } catch {
      // not found -> upload
    }
    const res = await client.object.delegateUploadObject(
      {
        bucketName: this.cfg.bucket,
        objectName,
        body: { name: objectName, type: contentType, size: bytes.byteLength, content: Buffer.from(bytes) },
        contentType,
        delegatedOpts: { visibility: VisibilityType.VISIBILITY_TYPE_PRIVATE },
        endpoint: this.cfg.spEndpoint,
      },
      this.auth(),
    );
    if (res.code !== 0) throw new Error(`Greenfield upload failed: ${res.message ?? res.code}`);
  }

  async get(hash: Bytes32Hex): Promise<StoredEvidence | null> {
    const client = await this.client();
    const res = await client.object.getObject(
      { bucketName: this.cfg.bucket, objectName: this.objectName(hash), endpoint: this.cfg.spEndpoint },
      this.auth(),
    );
    if (res.code !== 0 || !res.body) return null;
    const bytes = new Uint8Array(await res.body.arrayBuffer());
    const contentType = sniffContentType(bytes);
    if (!contentType) return null;
    return { hash, bytes, contentType };
  }
}
