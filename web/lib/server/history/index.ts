import { getAddress, type Address } from "viem";
import type { Env } from "../../actions/context";
import type { SupportedChainId } from "../../actions/fields";
import { eventsOfLease } from "../../chainIndex";
import { summarizeRentals, type ChainEvent } from "../../rentals";
import { factsSummary, settledSentence, walletFacts, type AiClaim, type Party } from "../../walletHistory";
import { chainIndexer } from "../chainIndex";
import { getSharedState, update, type SharedState } from "../state";
import { walletMemoryFromEnv, type RecalledWalletEntry, type WalletMemory } from "../sponsors/walletMemory";

/**
 * A wallet's history for the dispute desk (docs/ARCHITECTURE.md "Dispute memory per wallet"):
 *   facts   exact counts from the chain index (lib/walletHistory.ts), plus the AI proposals this server recorded
 *   memory  what Living Brain (or the local stand-in) remembers under "wallet:<address>", with tx links
 * Memory is written only by rememberSettlement, for a rental the chain index shows as settled; never from a request's
 * text. When memory fails, the facts still come back and `memory.error` says why.
 */

export const DISCLAIMER = "The AI summarises; the dispute desk decides.";

/** AI proposals kept per rental, and for how long. */
const AI_KEEP = 5;
const AI_TTL_MS = 90 * 86_400_000;
/** Most rentals of one wallet whose AI proposals are read (one state read each). */
const AI_LOOKUPS = 25;

const aiKey = (chainId: number, lease: string) => `ai-claims:${chainId}:${lease.toLowerCase()}`;
const writtenKey = (chainId: number, tx: string, wallet: string) => `wallet-memory-written:${chainId}:${tx.toLowerCase()}:${wallet.toLowerCase()}`;

/** Records the AI inspection's proposal for a rental verified on-chain (POST /api/settlement), for the claim-vs-AI fact. */
export async function recordAiClaim(chainId: number, lease: string, claim: AiClaim, state: SharedState = getSharedState()) {
  await update<AiClaim[], void>(state, aiKey(chainId, lease), (cur = []) => ({
    value: [...cur.filter((c) => c.reportHash !== claim.reportHash), claim].slice(-AI_KEEP),
    ttlMs: AI_TTL_MS,
    result: undefined,
  }));
}

export type HistoryDeps = {
  env?: Env;
  memory?: WalletMemory | null;
  state?: SharedState;
  /** The chain index (tests pass fixtures). */
  index?: () => Promise<{ events: ChainEvent[]; chainNow: bigint }>;
};

function indexFor(chainId: SupportedChainId, deps: HistoryDeps) {
  if (deps.index) return deps.index();
  const ix = chainIndexer(chainId, deps.env ?? process.env);
  if (!ix) throw new Error(`KeyEscrow is not deployed on chain ${chainId}`);
  return ix.get();
}

export type WalletHistory = Awaited<ReturnType<typeof walletHistory>>;

export async function walletHistory(wallet: Address, chainId: SupportedChainId, deps: HistoryDeps = {}) {
  const address = getAddress(wallet);
  const state = deps.state ?? getSharedState();
  const memory = deps.memory === undefined ? walletMemoryFromEnv(deps.env ?? process.env) : deps.memory;
  const recalled = memory
    ? memory.recall(address).then(
        (entries) => ({ entries, error: undefined as string | undefined }),
        (err: Error) => ({ entries: [] as RecalledWalletEntry[], error: err.message.slice(0, 200) }),
      )
    : null;

  const { events, chainNow } = await indexFor(chainId, deps);
  const w = address.toLowerCase();
  // Only rentals with an on-chain proposal can have a claim-vs-AI fact (each lookup is a state read).
  const proposed = new Set(events.filter((e) => e.name === "SettlementProposed").map((e) => e.address.toLowerCase()));
  const mine = events
    .filter((e) => e.name === "LeaseCreated" && (String(e.args.tenant).toLowerCase() === w || String(e.args.landlord).toLowerCase() === w))
    .map((e) => String(e.args.escrow).toLowerCase())
    .filter((l) => proposed.has(l))
    .slice(-AI_LOOKUPS);
  const aiClaims: Record<string, AiClaim[]> = {};
  await Promise.all(
    mine.map(async (l) => {
      const v = (await state.get<AiClaim[]>(aiKey(chainId, l)))?.value;
      if (v?.length) aiClaims[l] = v;
    }),
  );
  const facts = walletFacts(events, address, chainNow, aiClaims);
  const mem = recalled ? await recalled : null;
  return {
    chainId,
    address,
    facts,
    summary: factsSummary(facts),
    memory: memory ? { ...memory.status, entries: mem!.entries, ...(mem!.error ? { error: mem!.error } : {}) } : null,
    note: DISCLAIMER,
  };
}

export type RememberResult = { stored: number; skipped: number; reason?: "not-a-rental" | "not-settled"; errors?: string[] };

/**
 * After a settlement, a dispute ruling or a timeout: one factual capture per party, from the chain index only (a
 * rental of this deployment's factory with a Settled event). Idempotent per (transaction, wallet): a marker in shared
 * state skips repeat calls, and Living Brain dedupes on the same originRef.
 */
export async function rememberSettlement(lease: Address, chainId: SupportedChainId, deps: HistoryDeps = {}): Promise<RememberResult> {
  const state = deps.state ?? getSharedState();
  const memory = deps.memory === undefined ? walletMemoryFromEnv(deps.env ?? process.env) : deps.memory;
  const { events, chainNow } = await indexFor(chainId, deps);
  const [r] = summarizeRentals(eventsOfLease(events, lease), chainNow);
  if (!r) return { stored: 0, skipped: 0, reason: "not-a-rental" };
  if (!r.settled) return { stored: 0, skipped: 0, reason: "not-settled" };
  const out: RememberResult = { stored: 0, skipped: 0 };
  for (const party of ["renter", "owner"] as Party[]) {
    const wallet = (party === "renter" ? r.tenant : r.landlord).toLowerCase();
    const key = writtenKey(chainId, r.settled.txHash, wallet);
    if (!memory || (await state.get(key))) {
      out.skipped++;
      continue;
    }
    const res = await memory.remember({ wallet, lease: r.address, txHash: r.settled.txHash, text: settledSentence(r, party)!, at: new Date(Number(r.settled.at) * 1000).toISOString() });
    if (res.stored) {
      out.stored++;
      await state.set(key, 0, true, { ttlMs: AI_TTL_MS });
    } else (out.errors ??= []).push(res.error ?? "not stored");
  }
  return out;
}
