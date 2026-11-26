/**
 * What an action runs against: one chain (public RPC client + KeyEscrow addresses), a clock and a price source.
 * Built per call from plain env values, so it works the same in `next start`, the agent (Node) and Cloudflare
 * Workers: no fs, no process-global state, fetch-based RPC. Nothing here ever holds a private key.
 */
import { createPublicClient, http, type Address, type PublicClient, type Transport } from "viem";
import { getDeployment, TOKEN } from "../contracts";
import type { PriceQuote } from "../server/price";
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from "./fields";

export type Env = Record<string, string | undefined>;

export interface ActionContext {
  chainId: SupportedChainId;
  client: PublicClient;
  deployment: { escrowFactory: Address; token: Address; disputeDesk?: Address };
  /** Current fiat quote (GET /api/price's service); optional, actions degrade without it. */
  prices?: () => Promise<PriceQuote>;
  /** A wallet's dispute history on this chain (lib/server/history): facts from the chain index + Living Brain memory. */
  history?: (wallet: Address) => Promise<unknown>;
}

/** Everything a host (Next route, MCP server, test) supplies; the context for a given chain is derived from it. */
export interface ActionHost {
  env: Env;
  prices?: () => Promise<PriceQuote>;
  /** wallet_history's source (server only: it reads the chain index and Living Brain). Absent: the action says so. */
  history?: (wallet: Address, chainId: SupportedChainId) => Promise<unknown>;
  /** Override the RPC transport per chain (tests). */
  transport?: (chainId: SupportedChainId) => Transport;
}

/** A failure with an HTTP status and a stable code; `message` is a plain sentence a person can act on. */
export class ActionError extends Error {
  constructor(
    readonly status: number,
    readonly code: "invalid_input" | "unknown_action" | "unsupported_chain" | "not_found" | "precondition_failed" | "simulation_reverted" | "rpc_unavailable",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ActionError";
  }

  toJSON() {
    return { error: this.message, code: this.code, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

/** Default chain: KEYESCROW_CHAIN_ID, else the web build's NEXT_PUBLIC_CHAIN_ID, else local anvil. */
export function defaultChainId(env: Env): SupportedChainId {
  const id = Number(env.KEYESCROW_CHAIN_ID || env.NEXT_PUBLIC_CHAIN_ID || 31337);
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id) ? (id as SupportedChainId) : SUPPORTED_CHAIN_IDS[0];
}

/**
 * Server-side RPC per chain. 97 defaults to PublicNode (bnbchain.org's data-seed nodes refuse eth_getLogs);
 * 5611 to BNB Chain's opBNB testnet endpoint; 31337 to the anvil the web app uses.
 */
export function rpcUrl(chainId: SupportedChainId, env: Env): string {
  const own = env[`KEYESCROW_RPC_URL_${chainId}`];
  if (own) return own;
  if (chainId === 97) return env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
  if (chainId === 5611) return env.NEXT_PUBLIC_OPBNB_TESTNET_RPC_URL || "https://opbnb-testnet-rpc.bnbchain.org";
  if (chainId === 56) return env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-rpc.publicnode.com";
  return env.NEXT_PUBLIC_RPC_URL || env.NEXT_PUBLIC_ANVIL_RPC_URL || "http://127.0.0.1:8545";
}

export function actionContext(host: ActionHost, chainId?: number): ActionContext {
  const id = chainId ?? defaultChainId(host.env);
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(id)) {
    throw new ActionError(400, "unsupported_chain", `Chain ${id} is not supported by this server. Use ${SUPPORTED_CHAIN_IDS.join(", ")}.`);
  }
  const cid = id as SupportedChainId;
  const d = getDeployment(cid);
  if (!d) throw new ActionError(400, "unsupported_chain", `KeyEscrow is not deployed on chain ${cid}.`);
  // Every amount is parsed and formatted with the target chain's token; refuse a chain whose token differs.
  if (d.tokenDecimals !== TOKEN.decimals) {
    throw new ActionError(400, "unsupported_chain", `Chain ${cid}'s token has ${d.tokenDecimals} decimals; this server works in ${TOKEN.decimals}-decimal ${TOKEN.symbol}.`);
  }
  // JSON-RPC batch: readLease's ~17 reads go out as one HTTP request (Workers Free allows 50 subrequests per request).
  const transport = host.transport?.(cid) ?? http(rpcUrl(cid, host.env), { batch: true, timeout: 15_000, retryCount: 1 });
  return {
    chainId: cid,
    client: createPublicClient({ transport }) as PublicClient,
    deployment: { escrowFactory: d.escrowFactory, token: d.mockUsdt, disputeDesk: d.disputeDesk },
    prices: host.prices,
    ...(host.history ? { history: (wallet: Address) => host.history!(wallet, cid) } : {}),
  };
}
