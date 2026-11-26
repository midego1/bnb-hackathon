import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hex } from "viem";
import type { Env } from "../env";
import { onCloudflare } from "../platform";
import { getSharedState, update } from "../state";
import { livingBrainCall, livingBrainConfig, type FetchLike, type MemoryStatus } from "./livingbrain";
import { sponsorLogDir } from "./log";

/**
 * Dispute memory per wallet: one factual sentence per party after a rental settled on-chain (lib/server/history writes
 * it, lib/walletHistory.ts settledSentence words it). Living Brain when LIVING_BRAIN_* is set, labelled
 * "wallet:<address>"; otherwise a local stand-in (web/.sponsor-logs/wallets.jsonl, or the KeyEscrowState Durable
 * Object on Workers) that says so. Wallet addresses only: no names, no free text from people, no AI opinion of them.
 */

export interface WalletMemoryEntry {
  /** Lowercase wallet address. */
  wallet: string;
  lease: Address;
  txHash: Hex;
  text: string;
  at: string;
}

export interface RecalledWalletEntry {
  text: string;
  txHash?: Hex;
  lease?: Address;
  source: "living-brain" | "local";
}

export interface WalletMemory {
  status: MemoryStatus;
  recall(wallet: string): Promise<RecalledWalletEntry[]>;
  remember(entry: WalletMemoryEntry): Promise<{ stored: boolean; error?: string }>;
}

export const walletLabel = (wallet: string) => `wallet:${wallet.toLowerCase()}`;

const TX = /0x[0-9a-fA-F]{64}/;
const RENTAL = /rental (0x[0-9a-fA-F]{40})/;
/** Pulls the transaction and rental back out of a stored sentence, for the links. */
function parse(text: string, source: RecalledWalletEntry["source"]): RecalledWalletEntry {
  return { text, source, txHash: text.match(TX)?.[0] as Hex | undefined, lease: text.match(RENTAL)?.[1] as Address | undefined };
}

export class LivingBrainWalletMemory implements WalletMemory {
  readonly status: MemoryStatus = { provider: "living-brain", configured: true };
  constructor(
    private readonly cfg: ReturnType<typeof livingBrainConfig>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async recall(wallet: string): Promise<RecalledWalletEntry[]> {
    const w = wallet.toLowerCase();
    const hits = await livingBrainCall<Array<{ title?: string; summary?: string; status?: string }>>(this.cfg, this.fetchImpl, "POST", "/search", {
      query: walletLabel(w),
      topK: 10,
      minSimilarity: 0.3,
    });
    // Search is semantic: keep only pages that name this exact wallet.
    return (Array.isArray(hits) ? hits : [])
      .filter((h) => h.status !== "archived" && `${h.title ?? ""} ${h.summary ?? ""}`.toLowerCase().includes(w))
      .map((h) => parse(h.summary || h.title || "", "living-brain"));
  }

  async remember(e: WalletMemoryEntry) {
    try {
      await livingBrainCall(this.cfg, this.fetchImpl, "POST", "/captures", {
        kind: "note",
        label: walletLabel(e.wallet),
        content: e.text,
        bucket: "notes",
        // Idempotency key: the settling transaction, per party (both parties' captures come from the same tx).
        originRef: `${e.txHash}:${e.wallet.toLowerCase()}`,
        source: { channel: "keyescrow", ref: e.txHash, label: walletLabel(e.wallet) },
      });
      return { stored: true };
    } catch (err) {
      return { stored: false, error: (err as Error).message };
    }
  }
}

const sameEntry = (a: WalletMemoryEntry, b: WalletMemoryEntry) => a.wallet === b.wallet && a.txHash.toLowerCase() === b.txHash.toLowerCase();

/** Offline stand-in under Node: an append-only JSONL file, one entry per (transaction, wallet). */
export class LocalWalletMemory implements WalletMemory {
  readonly status: MemoryStatus;
  constructor(
    private readonly file: string,
    reason: string,
  ) {
    this.status = { provider: "local", configured: false, reason };
  }

  private async all(): Promise<WalletMemoryEntry[]> {
    try {
      return (await readFile(this.file, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  async recall(wallet: string) {
    const w = wallet.toLowerCase();
    return (await this.all())
      .filter((e) => e.wallet === w)
      .slice(-10)
      .reverse()
      .map((e) => parse(e.text, "local"));
  }

  async remember(e: WalletMemoryEntry) {
    if ((await this.all()).some((x) => sameEntry(x, e))) return { stored: true };
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(e)}\n`);
    return { stored: true };
  }
}

/** The same stand-in on Workers (no disk): the KeyEscrowState Durable Object, newest 500 kept. */
export class SharedWalletMemory implements WalletMemory {
  static readonly KEY = "wallet-memory";
  readonly status: MemoryStatus;
  constructor(reason: string) {
    this.status = { provider: "local", configured: false, reason };
  }

  async recall(wallet: string) {
    const w = wallet.toLowerCase();
    const all = (await getSharedState().get<WalletMemoryEntry[]>(SharedWalletMemory.KEY))?.value ?? [];
    return all
      .filter((e) => e.wallet === w)
      .slice(-10)
      .reverse()
      .map((e) => parse(e.text, "local"));
  }

  async remember(e: WalletMemoryEntry) {
    await update<WalletMemoryEntry[], void>(getSharedState(), SharedWalletMemory.KEY, (cur = []) =>
      cur.some((x) => sameEntry(x, e)) ? { result: undefined } : { value: [...cur, e].slice(-500), result: undefined },
    );
    return { stored: true };
  }
}

export function walletMemoryFromEnv(env: Env = process.env, fetchImpl: FetchLike = fetch): WalletMemory {
  const cfg = livingBrainConfig(env);
  if (cfg.configured) return new LivingBrainWalletMemory(cfg, fetchImpl);
  const reason = `Living Brain not configured: set ${cfg.missing.join(", ") || "LIVING_BRAIN_*"}. Using local memory.`;
  if (onCloudflare()) return new SharedWalletMemory(reason);
  return new LocalWalletMemory(path.join(sponsorLogDir(env), "wallets.jsonl"), reason);
}
