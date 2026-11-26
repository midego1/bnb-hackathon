import path from "node:path";
import { REPO_DIR } from "./config.ts";
import type { InspectionMemory } from "../../web/lib/server/sponsors/livingbrain.ts";
import type { Address } from "viem";
import type { SupportedChainId } from "../../web/lib/actions/fields.ts";
import type { EvidenceStore } from "./shared.ts";

let storePromise: Promise<EvidenceStore> | null = null;

/** Node only: the web app's evidence store (Greenfield or local disk), loaded lazily. Mock mode never touches it. */
export function nodeEvidenceStore(): Promise<EvidenceStore> {
  // Share the web app's local fallback directory unless told otherwise.
  process.env.EVIDENCE_DIR ??= path.join(REPO_DIR, "web", ".evidence");
  storePromise ??= import("../../web/lib/server/evidence/index.ts").then((m) => m.getEvidenceStore());
  return storePromise;
}

/** Node only: Living Brain when configured, else web/.sponsor-logs/inspections.jsonl (shared with the web app; read-only here). */
export async function nodeInspectionMemory(): Promise<InspectionMemory> {
  process.env.SPONSOR_LOG_DIR ??= path.join(REPO_DIR, "web", ".sponsor-logs");
  const m = await import("../../web/lib/server/sponsors/livingbrain.ts");
  return m.inspectionMemoryFromEnv();
}

/** Node only: wallet_history from the web app's code (its own chain index; Living Brain, else the shared local file). */
export async function nodeWalletHistory(wallet: Address, chainId: SupportedChainId): Promise<unknown> {
  process.env.SPONSOR_LOG_DIR ??= path.join(REPO_DIR, "web", ".sponsor-logs");
  const m = await import("../../web/lib/server/history/index.ts");
  return m.walletHistory(wallet, chainId);
}
