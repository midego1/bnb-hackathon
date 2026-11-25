import { isAddressEqual, recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Env } from "../env";
import { canonicalJson, sha256Hex, type Bytes32Hex } from "../hash";

export const INSPECTOR_NAME = "KeyEscrow Inspector";

/**
 * Who produced a settlement report. It goes into the hashed report, so `reportHash` (and with it the on-chain
 * `RentalEscrow.propose` call) commits to the inspector's identity.
 */
export interface InspectorIdentity {
  name: string;
  /** Address of the key that signs reports. It is recorded on the ERC-8004 identity as `reportSigner` metadata. */
  address: Address;
  /** ERC-8004 agent id (token id in the Identity Registry), decimal string. Absent until registered. */
  agentId?: string;
  /** CAIP-10 style registry reference `eip155:<chainId>:<registry>`, as in ERC-8004 registration files. */
  agentRegistry?: string;
}

export interface InspectorSigner {
  identity: InspectorIdentity;
  /** EIP-191 `personal_sign` over the 32 raw bytes of the report hash. */
  signReport(reportHash: Bytes32Hex): Promise<Hex>;
}

export class InspectorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectorConfigError";
  }
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const REGISTRY_RE = /^eip155:\d+:0x[0-9a-fA-F]{40}$/;

export function inspectorSignerFromKey(
  privateKey: Hex,
  ids: { agentId?: string; agentRegistry?: string; name?: string } = {},
): InspectorSigner {
  if (!KEY_RE.test(privateKey)) throw new InspectorConfigError("inspector key must be 0x + 64 hex characters");
  if (ids.agentId !== undefined && !/^\d{1,78}$/.test(ids.agentId)) {
    throw new InspectorConfigError("INSPECTOR_AGENT_ID must be a non-negative integer");
  }
  if (ids.agentRegistry !== undefined && !REGISTRY_RE.test(ids.agentRegistry)) {
    throw new InspectorConfigError("INSPECTOR_AGENT_REGISTRY must look like eip155:<chainId>:0x<registry>");
  }
  const account = privateKeyToAccount(privateKey);
  const identity: InspectorIdentity = {
    name: ids.name ?? INSPECTOR_NAME,
    address: account.address,
    ...(ids.agentId !== undefined ? { agentId: ids.agentId } : {}),
    ...(ids.agentRegistry !== undefined ? { agentRegistry: ids.agentRegistry } : {}),
  };
  return { identity, signReport: (reportHash) => account.signMessage({ message: { raw: reportHash } }) };
}

/**
 * The report signer from server-side env, or null when INSPECTOR_PRIVATE_KEY is unset (reports are then unsigned and
 * carry no inspector field, exactly as before). INSPECTOR_AGENT_ID / INSPECTOR_AGENT_REGISTRY come from the ERC-8004
 * registration (`pnpm agent:register`, see docs/AGENT.md). Never use a NEXT_PUBLIC_ name for the key.
 */
export function inspectorFromEnv(env: Env = process.env): InspectorSigner | null {
  const key = env.INSPECTOR_PRIVATE_KEY?.trim();
  if (!key) return null;
  return inspectorSignerFromKey(key as Hex, {
    agentId: env.INSPECTOR_AGENT_ID?.trim() || undefined,
    agentRegistry: env.INSPECTOR_AGENT_REGISTRY?.trim() || undefined,
  });
}

/** Human label, e.g. "Signed by KeyEscrow Inspector, ERC-8004 agent #3". */
export function inspectorLabel(identity: InspectorIdentity): string {
  return `Signed by ${identity.name}${identity.agentId !== undefined ? `, ERC-8004 agent #${identity.agentId}` : ""}`;
}

export interface ReportVerification {
  /** reportHash matches the canonical JSON of the report body. */
  hashValid: boolean;
  /** Address recovered from inspectorSignature (null when unsigned or malformed). */
  signer: Address | null;
  /** The signature was made by the inspector address named inside the hashed report. */
  signatureValid: boolean;
}

/**
 * Offline check of a settlement result: recompute reportHash and recover the signer. Callers then compare
 * `signer` with the `reportSigner` metadata of ERC-8004 agent `inspector.agentId` on chain.
 */
export async function verifyInspectorReport(result: Record<string, unknown>): Promise<ReportVerification> {
  const { reportHash, inspectorSignature, ...body } = result as {
    reportHash?: string;
    inspectorSignature?: string;
    [k: string]: unknown;
  };
  const hashValid = typeof reportHash === "string" && sha256Hex(canonicalJson(body)) === reportHash;
  let signer: Address | null = null;
  if (typeof reportHash === "string" && typeof inspectorSignature === "string") {
    try {
      signer = await recoverMessageAddress({ message: { raw: reportHash as Hex }, signature: inspectorSignature as Hex });
    } catch {
      signer = null;
    }
  }
  const claimed = (body.inspector as InspectorIdentity | undefined)?.address;
  const signatureValid = hashValid && signer !== null && typeof claimed === "string" && isAddressEqual(signer, claimed);
  return { hashValid, signer, signatureValid };
}
