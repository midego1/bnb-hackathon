"use client";

import { Notice } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n/client";

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
  /** What failed to load, in the active language ("your rentals"); default "the chain". */
  what?: string;
};

/**
 * The one retry state every chain-backed view shows when a read fails: a blocking error with a Retry button when there
 * is nothing to show yet, or a warning above the last good data. Polling keeps retrying on its own every 8 s.
 */
export function ChainReadNotice({ error, hasData, stale, block, onRetry, retrying, what }: Props) {
  const t = useT();
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
      {retrying ? t("shell.read.retrying") : t("shell.read.retry")}
    </Button>
  );
  if (!hasData) {
    return (
      <div data-testid="chain-read-error" data-state="error">
        <Notice kind="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {t("shell.read.failed", { what: what ?? t("shell.read.chain") })}
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
            {t("shell.read.stale")}
            {block !== undefined ? t("shell.read.block", { block: block.toString() }) : ""}
            {stale ? t("shell.read.since", { date: formatDate(BigInt(Math.floor(stale.since / 1000)), t.lang) }) : ""}
            {t("shell.read.staleEnd")}
          </span>
          {button}
        </div>
      </Notice>
    </div>
  );
}
