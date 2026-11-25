import type { Abi, Hex } from "viem";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "../contracts";
import type { DevRole } from "../devAccounts";
import { formatUsdt } from "../format";
import type { DemoApi } from "./script";

/**
 * The pacing layer of the /demo runner, kept apart from how a step is executed (lib/demo/script.ts and the runner's
 * DemoApi): how long each caption stays up, pause / resume / skip, and a view of what the executor is doing right
 * now (`instrumentApi` wraps any DemoApi, local anvil or otherwise).
 *
 * Guided speed plays every step in three beats: "now" (what happens, who acts), "run" (the transactions, one line
 * each) and "changed" (the money that moved and why it matters). An intro card comes before step 1.
 */

export type Speed = "guided" | "normal" | "fast";
export type Beat = "intro" | "now" | "run" | "changed";

/** Reading speed for the captions, in words per minute. */
export const WPM = 200;

/** Guided timings (before the time scale). Caption beats last their reading time, at least the minimum here. */
export const GUIDED = {
  introMinMs: 10_000,
  nowMinMs: 6_000,
  changedMinMs: 5_000,
  /** The "Signing as … → calling …" line stays up this long before the transaction is sent. */
  leadMs: 1_000,
  /** After the last transaction of a step, so its hash can be seen before "What just changed". */
  afterRunMs: 1_000,
  maxMs: 30_000,
};

/** How long `text` takes to read at `wpm`, clamped to [minMs, maxMs]. */
export function readingMs(text: string, { wpm = WPM, minMs = GUIDED.nowMinMs, maxMs = GUIDED.maxMs }: { wpm?: number; minMs?: number; maxMs?: number } = {}) {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const ms = Math.round((words / wpm) * 60_000);
  return Math.min(Math.max(ms, minMs), Math.max(minMs, maxMs));
}

/** `?timescale=0.05` shortens every Guided wait (tests); anything outside (0, 10] means 1. */
export function parseTimeScale(search: string): number {
  const v = Number(new URLSearchParams(search).get("timescale"));
  return Number.isFinite(v) && v > 0 && v <= 10 ? v : 1;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What the progress bar shows: the current wait, how far along it is, and whether it is waiting for a click. */
export type Clock = { id: number; durationMs: number; elapsedMs: number; frozen: boolean; untilClick: boolean; active: boolean };

const TICK = 100;

/**
 * Waits that count only unpaused time and end early on skip() (the Next button), on cancellation (restart) or
 * when the presenter leaves Guided speed. A small external store, so only the progress bar re-renders on each tick.
 */
export class Pacer {
  private clock: Clock = { id: 0, durationMs: 0, elapsedMs: 0, frozen: false, untilClick: false, active: false };
  private listeners = new Set<() => void>();
  private skipped = false;

  constructor(
    private o: {
      /** False once the run this pacer belongs to was restarted or unmounted. */
      alive: () => boolean;
      paused: () => boolean;
      /** Step-by-step mode: caption beats wait for Next instead of a timer. */
      stepMode: () => boolean;
      /** Waits only apply in Guided speed. */
      guided: () => boolean;
      scale: () => number;
      onFreeze?: (frozen: boolean) => void;
    },
  ) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  getSnapshot = () => this.clock;
  private set(c: Partial<Clock>) {
    this.clock = { ...this.clock, ...c };
    this.listeners.forEach((l) => l());
  }

  /** Ends the current wait (Next →). Ignored when nothing is waiting, so a click mid-transaction skips nothing later. */
  skip() {
    if (this.clock.active) this.skipped = true;
  }

  /**
   * Wait `ms` (times the time scale) of unpaused Guided time. A `caption` wait waits for Next in step-by-step mode.
   * Resolves false when the run was cancelled.
   */
  async wait(ms: number, kind: "caption" | "timed" = "caption"): Promise<boolean> {
    if (!this.o.alive()) return false;
    if (!this.o.guided()) return true;
    this.skipped = false;
    const durationMs = Math.max(0, ms * this.o.scale());
    let elapsed = 0;
    let frozen = false;
    this.set({ id: this.clock.id + 1, durationMs, elapsedMs: 0, frozen: false, untilClick: kind === "caption" && this.o.stepMode(), active: true });
    try {
      for (;;) {
        if (!this.o.alive()) return false;
        if (this.skipped || !this.o.guided()) return true;
        const untilClick = kind === "caption" && this.o.stepMode();
        const nowFrozen = this.o.paused();
        if (nowFrozen !== frozen) {
          frozen = nowFrozen;
          this.o.onFreeze?.(frozen);
        }
        if (!untilClick && !frozen && elapsed >= durationMs) return true;
        const step = Math.min(TICK, Math.max(durationMs - elapsed, 10));
        await sleep(untilClick || frozen ? TICK : step);
        if (!untilClick && !frozen) elapsed += step;
        this.set({ elapsedMs: Math.min(elapsed, durationMs), frozen, untilClick });
      }
    } finally {
      if (frozen) this.o.onFreeze?.(false);
      this.skipped = false;
      this.set({ active: false });
    }
  }

  /** Returns once the presenter is not paused (any speed). False when cancelled. */
  async hold(): Promise<boolean> {
    if (!this.o.paused()) return this.o.alive();
    this.o.onFreeze?.(true);
    try {
      while (this.o.paused()) {
        if (!this.o.alive()) return false;
        await sleep(TICK);
      }
    } finally {
      this.o.onFreeze?.(false);
    }
    return this.o.alive();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What the executor is doing: one line per transaction, upload, AI inspection or clock jump
// ---------------------------------------------------------------------------------------------------------------

export type Activity = {
  id: number;
  status: "running" | "done" | "error";
} & (
  | { kind: "tx"; label: string; role?: DevRole; contract: string; fn: string; args: string; hash?: Hex }
  | { kind: "upload"; count: number }
  | { kind: "inspect" }
  | { kind: "time"; seconds: number }
);

/** The contract a call goes to, by its ABI. */
export function contractName(abi: Abi): string {
  if (abi === (rentalEscrowAbi as Abi)) return "RentalEscrow";
  if (abi === (escrowFactoryAbi as Abi)) return "EscrowFactory";
  if (abi === (mockUsdtAbi as Abi)) return "MockUSDT";
  return "contract";
}

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

/** Call arguments for one line on screen: short addresses and hashes, token amounts in mUSDT, structs as {…}. */
export function formatArgs(args: readonly unknown[] | undefined): string {
  if (!args?.length) return "";
  return args
    .map((a) => {
      if (typeof a === "bigint") return a >= BigInt(10_000) ? `${formatUsdt(a)} mUSDT` : a.toString();
      if (typeof a === "string") return /^0x[0-9a-fA-F]{40,}$/.test(a) ? short(a) : a;
      if (typeof a === "number" || typeof a === "boolean") return String(a);
      return "{…}";
    })
    .join(", ");
}

/**
 * Wrap a step executor's DemoApi so the stage can show what it is doing, and so Pause takes effect before the next
 * transaction instead of only between steps. `lead` runs after a transaction's line is on screen, before it is sent.
 */
export function instrumentApi(
  api: DemoApi,
  hooks: { gate: () => Promise<boolean>; lead: () => Promise<boolean>; onActivity: (a: Activity) => void },
): DemoApi {
  let seq = 0;
  let role: DevRole | undefined;
  const cancelled = () => new Error("The demo was restarted.");
  async function track<T>(start: Activity, work: () => Promise<T>, done?: (r: T) => Partial<Activity>): Promise<T> {
    if (!(await hooks.gate())) throw cancelled();
    hooks.onActivity(start);
    if (start.kind === "tx" && !(await hooks.lead())) throw cancelled();
    try {
      const r = await work();
      hooks.onActivity({ ...start, ...done?.(r), status: "done" } as Activity);
      return r;
    } catch (err) {
      hooks.onActivity({ ...start, status: "error" });
      throw err;
    }
  }
  return {
    ...api,
    async as(r) {
      role = r;
      await api.as(r);
    },
    tx: (label, call) =>
      track(
        { id: ++seq, status: "running", kind: "tx", label, role, contract: contractName(call.abi), fn: call.functionName, args: formatArgs(call.args) },
        () => api.tx(label, call),
        (receipt) => ({ hash: receipt.transactionHash }),
      ),
    upload: (files) => track({ id: ++seq, status: "running", kind: "upload", count: files.length }, () => api.upload(files)),
    inspect: (input) => track({ id: ++seq, status: "running", kind: "inspect" }, () => api.inspect(input)),
    fastForward: (seconds) => track({ id: ++seq, status: "running", kind: "time", seconds }, () => api.fastForward(seconds)),
  };
}

/** Fold an activity update into the list shown for the current step. */
export function upsertActivity(list: Activity[], a: Activity): Activity[] {
  const i = list.findIndex((x) => x.id === a.id);
  return i < 0 ? [...list, a] : list.map((x, k) => (k === i ? a : x));
}

