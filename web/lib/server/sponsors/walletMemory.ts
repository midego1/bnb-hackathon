import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hex } from "viem";
import type { Env } from "../env";
import { onCloudflare } from "../platform";
import { getSharedState, update, type SharedState } from "../state";
import { livingBrainCall, livingBrainConfig, notConfiguredReason, type FetchLike, type MemoryStatus } from "./livingbrain";
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
  /** `sent`: captured by Living Brain but not compiled yet (or its compile failed), shown from our own copy. */
  source: "living-brain" | "sent" | "local";
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

/** A Living Brain ingest source (GET /sources), the fields we read. */
type LbSource = { id: string; label?: string; content?: string | null; originRef?: string | null; status?: string; createdAt?: string };
/** What this server captured for a wallet, kept beside Living Brain: captures compile asynchronously into pages. */
type SentEntry = { id?: string; text: string; at: string };
const SENT_KEEP = 10;
const SENT_TTL_MS = 90 * 86_400_000;
const sentKey = (wallet: string) => `wallet-memory-sent:${wallet.toLowerCase()}`;

/**
 * Living Brain as the wallet memory. A capture is asynchronous (POST /captures returns an ingest source that compiles
 * into pages later), and compiled pages get their own title and summary, so a page search does not find our sentence
 * by wallet. The reader therefore reads the ingest sources themselves: exact content, label and compile status, in one
 * GET /sources call (by id for the captures this server recorded, else by label among the newest 100 sources).
 * Completed sources show as Living Brain, the rest as "sent to Living Brain".
 */
export class LivingBrainWalletMemory implements WalletMemory {
  readonly status: MemoryStatus = { provider: "living-brain", configured: true };
  constructor(
    private readonly cfg: ReturnType<typeof livingBrainConfig>,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly state: () => SharedState = getSharedState,
  ) {}

  async recall(wallet: string): Promise<RecalledWalletEntry[]> {
    const w = wallet.toLowerCase();
    const sent = (await this.state().get<SentEntry[]>(sentKey(w)))?.value ?? [];
    const ids = sent.flatMap((e) => (e.id ? [e.id] : []));
    // shortcut: without a recorded id (captures from before the copy existed) only the newest 100 sources are scanned.
    const q = ids.length ? `?ids=${ids.map(encodeURIComponent).join(",")}&limit=${ids.length}` : "?limit=100";
    let sources: LbSource[];
    try {
      sources = (await livingBrainCall<{ items?: LbSource[] }>(this.cfg, this.fetchImpl, "GET", `/sources${q}`))?.items ?? [];
    } catch (err) {
      if (!sent.length) throw err;
      sources = []; // Living Brain unreachable: still show what we sent, labelled as such
    }
    const mine = sources.filter((s) => s.label === walletLabel(w) || !!s.originRef?.toLowerCase().endsWith(`:${w}`));
    const seen = new Set<string>();
    const rows: { text: string; at: string; source: RecalledWalletEntry["source"] }[] = [];
    for (const s of mine) {
      if (!s.content || seen.has(s.id)) continue;
      seen.add(s.id);
      rows.push({ text: s.content, at: s.createdAt ?? "", source: s.status === "completed" ? "living-brain" : "sent" });
    }
    for (const e of sent) if (!e.id || !seen.has(e.id)) rows.push({ text: e.text, at: e.at, source: "sent" });
    return rows
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, SENT_KEEP)
      .map((r) => parse(r.text, r.source));
  }

  async remember(e: WalletMemoryEntry) {
    try {
      const res = await livingBrainCall<{ id?: string }>(this.cfg, this.fetchImpl, "POST", "/captures", {
        kind: "note",
        label: walletLabel(e.wallet),
        content: e.text,
        bucket: "notes",
        // Idempotency key: the settling transaction, per party (both parties' captures come from the same tx).
        originRef: `${e.txHash}:${e.wallet.toLowerCase()}`,
        source: { channel: "keyescrow", ref: e.txHash, label: walletLabel(e.wallet) },
      });
      await update<SentEntry[], void>(this.state(), sentKey(e.wallet), (cur = []) => ({
        value: [...cur.filter((x) => x.text !== e.text), { id: res?.id, text: e.text, at: new Date().toISOString() }].slice(-SENT_KEEP),
        ttlMs: SENT_TTL_MS,
        result: undefined,
      })).catch((err: Error) => console.warn("wallet memory: local copy not kept", err.message));
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
  const reason = notConfiguredReason(cfg);
  if (onCloudflare()) return new SharedWalletMemory(reason);
  return new LocalWalletMemory(path.join(sponsorLogDir(env), "wallets.jsonl"), reason);
}
