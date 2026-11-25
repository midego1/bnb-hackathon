"use client";

import { Notice } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

type Props = {
  /** The query's error (react-query), if the last fetch failed. */
  error: unknown;
  /** Whether usable data is on screen (then this is a warning above it, not a blocker). */
  hasData: boolean;
  /** Set by the server when it serves its last good snapshot because the RPC refused the refresh. */
  stale?: { error: string; since: number };
  /** Block the data on screen is from. */
  block?: bigint;
  onRetry: () => void;
  retrying?: boolean;
  what?: string;
};

/**
 * The one retry state every chain-backed view shows when a read fails: a blocking error with a Retry button when there
 * is nothing to show yet, or a warning above the last good data. Polling keeps retrying on its own every 8 s.
 */
export function ChainReadNotice({ error, hasData, stale, block, onRetry, retrying, what = "the chain" }: Props) {
  if (!error && !stale) return null;
  const reason = stale?.error ?? (error instanceof Error ? error.message : undefined);
  const button = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={onRetry}
      disabled={retrying}
      data-testid="chain-retry"
      className="ml-auto border-current bg-transparent text-current hover:bg-current/10 hover:text-current dark:border-current dark:bg-transparent dark:hover:bg-current/10"
    >
      {retrying ? "Retrying…" : "Retry now"}
    </Button>
  );
  if (!hasData) {
    return (
      <div data-testid="chain-read-error" data-state="error">
        <Notice kind="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not read {what} right now: the public RPC is busy or refused the request. The page retries every 8 s.
              {reason && <span className="block text-xs opacity-80">{reason}</span>}
            </span>
            {button}
          </div>
        </Notice>
      </div>
    );
  }
  return (
    <div data-testid="chain-read-error" data-state="stale">
      <Notice kind="warn">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Showing the last good read{block !== undefined ? ` (block ${block.toString()})` : ""}
            {stale ? `, since ${formatDate(BigInt(Math.floor(stale.since / 1000)))}` : ""}: refreshing failed, retrying every 8 s.
          </span>
          {button}
        </div>
      </Notice>
    </div>
  );
}
