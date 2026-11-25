/**
 * Ask AI's limits: per message (model steps, tool calls), per run (wall time), per caller (requests a minute) and per
 * server (tokens a UTC day, counted BEFORE each model request at an estimate, then settled to what it used).
 */
import type { AssistantStore } from "./store";

export const LIMITS = {
  stepsPerMessage: 10,
  toolCallsPerMessage: 15,
  runMs: 3 * 60_000,
  requestsPerMinute: 20,
  maxTokensPerStep: 4096,
  maxMessageChars: 2000,
  /** A conversation's stored history may not grow past this (then: start a new chat). */
  maxChatBytes: 400_000,
} as const;

export const DEFAULT_DAILY_TOKENS = 1_000_000;

export function dailyTokenLimit(env: Record<string, string | undefined>): number {
  const n = Number(env.ASSISTANT_DAILY_TOKENS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_TOKENS;
}

/** Sliding-ish window: a counter per caller per minute. Returns false when the caller is over the limit. */
export async function allowRequest(store: AssistantStore, caller: string, now = Date.now(), perMinute: number = LIMITS.requestsPerMinute): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  const n = await store.incr(`rate:${caller}:${minute}`, 1, 120_000);
  return n <= perMinute;
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Rough token count of a request body: ~4 characters a token, rounded up. */
export function estimateTokens(body: unknown): number {
  return Math.ceil(JSON.stringify(body ?? "").length / 4);
}

export type TokenUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/** What a request costs against the budget: cache reads count a tenth. */
export function usageTokens(u: TokenUsage): number {
  return u.input_tokens + (u.cache_creation_input_tokens ?? 0) + Math.ceil((u.cache_read_input_tokens ?? 0) / 10) + u.output_tokens;
}

export class TokenBudget {
  constructor(
    private readonly store: AssistantStore,
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  private key() {
    return `tokens:${day(this.now())}`;
  }

  /** Reserve `estimate` tokens before a request; false (and nothing reserved) when the day's budget is used up. */
  async reserve(estimate: number): Promise<boolean> {
    const used = await this.store.incr(this.key(), estimate, 26 * 3600_000);
    if (used - estimate >= this.limit) {
      await this.store.incr(this.key(), -estimate, 26 * 3600_000);
      return false;
    }
    return true;
  }

  /** Replace a reservation with what the request actually used (a cut-off request keeps its reservation). */
  async settle(estimate: number, actual: number): Promise<void> {
    await this.store.incr(this.key(), actual - estimate, 26 * 3600_000);
  }

  async used(): Promise<number> {
    return this.store.incr(this.key(), 0, 26 * 3600_000);
  }
}
