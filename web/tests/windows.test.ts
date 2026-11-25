import { describe, expect, it } from "vitest";
import { responseWindow, shareLock } from "@/lib/windows";

const T = BigInt(1_800_000_000);
const DAY = 86400;

describe("renter reply window (KE-02), judged on chain time", () => {
  const l = (timeoutAt: bigint, chainNow: bigint) => responseWindow({ timeoutAt, chainNow, responseWindowSeconds: 7 * DAY });
  it("is open before timeoutAt and closed from timeoutAt on", () => {
    expect(l(T, T - BigInt(1))).toMatchObject({ closed: false, reason: null });
    const closed = l(T, T);
    expect(closed.closed).toBe(true);
    expect(closed.reason).toMatch(/^The 7-day response window closed on 15 Jan 2027, 08:00 UTC.*renter can now claim the full deposit\.$/);
  });
  it("does not apply without a renter proposal (timeoutAt 0)", () => {
    expect(l(BigInt(0), T).closed).toBe(false);
  });
});

describe("fleet share lock (KE-01)", () => {
  it("locks until lockedUntil, then unlocks; never-deposited holders are unlocked", () => {
    const until = T + BigInt(7 * DAY);
    expect(shareLock(until, T)).toMatchObject({ locked: true, secondsLeft: 7 * DAY });
    expect(shareLock(until, T).reason).toMatch(/^Shares locked until 22 Jan 2027, 08:00 UTC \(7 days after your last deposit\)/);
    expect(shareLock(until, until)).toMatchObject({ locked: false, secondsLeft: 0, reason: null });
    expect(shareLock(BigInt(0), T).locked).toBe(false);
  });
});
