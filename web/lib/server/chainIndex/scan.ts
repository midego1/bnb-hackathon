/**
 * Small, pure building blocks of the server-side chain index (lib/server/chainIndex): bounded block ranges, retry
 * with exponential backoff for a public RPC that answers 429 / 403 / 5xx or times out, and splitting a log query when
 * the node refuses its block range. No I/O of their own (the sleep and the query are passed in), so they are
 * unit-tested in tests/chain-index.test.ts.
 */

export type BlockRange = { fromBlock: bigint; toBlock: bigint };

/** [from, to] cut into consecutive windows of at most `size` blocks (inclusive bounds). Empty when from > to. */
export function blockRanges(from: bigint, to: bigint, size: bigint): BlockRange[] {
  if (size < BigInt(1)) throw new Error("window size must be at least 1 block");
  const out: BlockRange[] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - BigInt(1);
    out.push({ fromBlock: start, toBlock: end > to ? to : end });
  }
  return out;
}

const text = (err: unknown): string => {
  if (!err || typeof err !== "object") return String(err ?? "");
  const e = err as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
  return [e.shortMessage, e.message, e.details, e.cause && e.cause !== err ? text(e.cause) : ""].filter(Boolean).join(" ");
};

const status = (err: unknown): number | undefined => {
  for (let e = err as { status?: unknown; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (typeof e.status === "number") return e.status;
  }
  return undefined;
};

/** The node refused the query because the block range (or result size) is too large: split it, do not retry as is. */
export function isRangeError(err: unknown): boolean {
  const t = text(err);
  if (RATE_LIMIT.test(t)) return false;
  return /block range|range (is )?too (large|wide|big)|exceed(s|ed)? (the )?max(imum)? (block )?range|limit exceeded|too many (logs|results)|query returned more than|response size/i.test(
    t,
  );
}

const RATE_LIMIT = /rate.?limit|too many requests/i;

/** Worth another try later: rate limits, gateway refusals, 5xx, timeouts and dropped connections. */
export function isRetryable(err: unknown): boolean {
  if (isRangeError(err)) return false;
  const s = status(err);
  if (s !== undefined) return s === 403 || s === 408 || s === 425 || s === 429 || s >= 500;
  return /rate.?limit|too many requests|429|403|forbidden|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|fetch failed|network|socket|temporar|unavailable|busy|-32005/i.test(text(err));
}

export type RetryOptions = {
  /** Total attempts including the first (default 4). */
  attempts?: number;
  /** First backoff in ms, doubled per retry (default 300). */
  baseMs?: number;
  /** Cap per backoff (default 4000). */
  maxMs?: number;
  /** Injected for tests; default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** 0..1, default Math.random: up to +50 % jitter so parallel callers do not retry in lockstep. */
  random?: () => number;
  /** Which errors to retry (default isRetryable). */
  retryable?: (err: unknown) => boolean;
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The backoff before retry number `retry` (1-based): base * 2^(retry-1), capped, plus jitter. */
export function backoffMs(retry: number, opts: Pick<RetryOptions, "baseMs" | "maxMs" | "random"> = {}): number {
  const base = opts.baseMs ?? 300;
  const raw = Math.min(opts.maxMs ?? 4_000, base * 2 ** (retry - 1));
  return Math.round(raw * (1 + 0.5 * (opts.random ?? Math.random)()));
}

/** Runs `fn`, retrying retryable failures with exponential backoff; the last error is rethrown. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const wait = opts.sleep ?? sleep;
  const retryable = opts.retryable ?? isRetryable;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !retryable(err)) throw err;
      await wait(backoffMs(i, opts));
    }
  }
}

/**
 * Runs a log query over `range`; when the node refuses the range (isRangeError), splits it in two halves and recurses,
 * down to `minSize` blocks. Transient errors are retried by `withRetry` inside `query` (the caller's choice).
 */
export async function splitOnRangeError<T>(range: BlockRange, query: (r: BlockRange) => Promise<T[]>, minSize = BigInt(100)): Promise<T[]> {
  try {
    return await query(range);
  } catch (err) {
    const size = range.toBlock - range.fromBlock + BigInt(1);
    if (!isRangeError(err) || size <= minSize) throw err;
    const mid = range.fromBlock + size / BigInt(2) - BigInt(1);
    const left = await splitOnRangeError({ fromBlock: range.fromBlock, toBlock: mid }, query, minSize);
    const right = await splitOnRangeError({ fromBlock: mid + BigInt(1), toBlock: range.toBlock }, query, minSize);
    return [...left, ...right];
  }
}

/** `fn` over `items` with at most `limit` in flight, results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * One promise per key at a time: concurrent callers share the in-flight run (per isolate), so a burst of page loads
 * triggers one refresh, not one each.
 */
export function singleflight<T>() {
  const inflight = new Map<string, Promise<T>>();
  return (key: string, fn: () => Promise<T>): Promise<T> => {
    const cur = inflight.get(key);
    if (cur) return cur;
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
