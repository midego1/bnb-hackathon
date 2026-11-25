/**
 * Pure rules for the two deadlines added by the security review (docs/SECURITY.md), shared by the web UI and the
 * agent actions. Always fed with CHAIN time (latest block timestamp), never the browser clock.
 *  - KE-02: once a renter's proposal has sat for `responseWindow`, propose / accept / dispute revert for everyone and
 *    only claimTimeout works (full deposit to the renter).
 *  - KE-01: FleetVault shares are locked for 7 days after the holder's latest deposit; claiming income is never locked.
 */

export const SHARE_LOCK_SECONDS = 7 * 86400;

const UTC_DATE = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

export type ResponseWindow = {
  /** The renter's proposal is waiting and its reply window has closed: only the timeout claim works. */
  closed: boolean;
  /** When the window closes / closed (0 = no renter proposal waiting). */
  closesAt: bigint;
  /** Plain explanation once closed, else null. */
  reason: string | null;
};

/** `timeoutAt` is RentalEscrow.timeoutAt(): 0 unless a renter proposal is waiting in MoveOut. */
export function responseWindow(l: { timeoutAt: bigint; chainNow: bigint; responseWindowSeconds: number }): ResponseWindow {
  const closesAt = l.timeoutAt;
  const closed = closesAt > BigInt(0) && l.chainNow >= closesAt;
  const days = Math.round(l.responseWindowSeconds / 86400);
  return {
    closed,
    closesAt,
    reason: closed
      ? `The ${days}-day response window closed on ${UTC_DATE(closesAt)}. The renter can now claim the full deposit.`
      : null,
  };
}

export type ShareLock = {
  locked: boolean;
  /** Unix seconds the lock ends (0 = never deposited). */
  until: bigint;
  /** Seconds left (0 when unlocked). */
  secondsLeft: number;
  reason: string | null;
};

/** `lockedUntil` is FleetVault.lockedUntil(holder). */
export function shareLock(lockedUntil: bigint, chainNow: bigint): ShareLock {
  const locked = lockedUntil > chainNow;
  return {
    locked,
    until: lockedUntil,
    secondsLeft: locked ? Number(lockedUntil - chainNow) : 0,
    reason: locked ? `Shares locked until ${UTC_DATE(lockedUntil)} (7 days after your last deposit). Claiming income still works.` : null,
  };
}
