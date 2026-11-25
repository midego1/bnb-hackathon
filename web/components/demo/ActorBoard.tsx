"use client";

import type { DemoActor } from "@/lib/demo/script";
import { formatFiat, toFiat } from "@/lib/fiat";
import { formatUsdt } from "@/lib/format";
import { usePrices } from "@/lib/usePrices";
import { actorCards, panels } from "./copy";

/** Live mUSDT balances of everyone the money can reach. `escrow` is unset until the demo lease exists. */
export type Wallets = { landlord: bigint; tenant: bigint; treasury: bigint; escrow?: bigint };
type WalletKey = keyof Wallets;

const ZERO = BigInt(0);
const ORDER: WalletKey[] = ["tenant", "landlord", "escrow", "treasury"];

/** "฿14,559", or the token amount until the THB rate loads. */
export function useThb() {
  const { prices } = usePrices();
  return (v: bigint) => {
    const thb = toFiat(v < ZERO ? -v : v, "USDT", "THB", prices);
    return thb === null ? `${formatUsdt(v < ZERO ? -v : v)} mUSDT` : formatFiat(thb, "THB");
  };
}

/** Net change per wallet since `base` (the balances when the current step started). */
export function deltas(base: Wallets | null, now: Wallets | null): Partial<Record<WalletKey, bigint>> {
  if (!base || !now) return {};
  const out: Partial<Record<WalletKey, bigint>> = {};
  for (const k of ORDER) {
    const d = (now[k] ?? ZERO) - (base[k] ?? ZERO);
    if (d !== ZERO) out[k] = d;
  }
  return out;
}

const tone: Record<WalletKey | "arbiter" | "inspector", string> = {
  landlord: "bg-violet-500",
  tenant: "bg-emerald-500",
  escrow: "bg-amber-500",
  treasury: "bg-sky-500",
  arbiter: "bg-rose-500",
  inspector: "bg-cyan-500",
};

/** Which card lights up for the actor of the current step. */
const actorCard: Partial<Record<DemoActor, WalletKey | "arbiter" | "inspector">> = {
  landlord: "landlord",
  tenant: "tenant",
  arbiter: "arbiter",
  inspector: "inspector",
};

/**
 * The left column of the stage: landlord, tenant, this lease's escrow and the KeyEscrow treasury with their live
 * balances, plus the two referees that never hold money. A card flashes and shows the step's net change when money
 * moves through it.
 */
export function ActorBoard({ wallets, base, actor }: { wallets: Wallets | null; base: Wallets | null; actor?: DemoActor }) {
  const d = deltas(base, wallets);
  const active = actor ? actorCard[actor] : undefined;
  return (
    <aside className="relative grid grid-cols-2 gap-2 lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto" aria-label="Who holds the money" data-testid="demo-actors">
      {ORDER.map((k) => (
        <MoneyCard key={k} id={k} value={wallets?.[k]} delta={d[k]} active={active === k} />
      ))}
      <div className="col-span-2 grid grid-cols-2 gap-2">
        <RefereeCard id="arbiter" active={active === "arbiter"} />
        <RefereeCard id="inspector" active={active === "inspector"} />
      </div>
    </aside>
  );
}

const cardBase = "relative overflow-hidden rounded-xl border bg-surface transition-shadow";
const ring = (active: boolean) =>
  active ? "border-amber-400 ring-2 ring-amber-400 dark:border-amber-500 dark:ring-amber-500" : "border-border";

function MoneyCard({ id, value, delta, active }: { id: WalletKey; value?: bigint; delta?: bigint; active: boolean }) {
  const { prices } = usePrices();
  const thb = useThb();
  const copy = actorCards[id];
  const usd = value === undefined ? null : toFiat(value, "USDT", "USD", prices);
  return (
    <div
      className={`${cardBase} ${ring(active)} px-3 py-2.5`}
      data-testid={`demo-actor-${id}`}
      data-balance={value?.toString() ?? ""}
      data-active={active ? "true" : "false"}
    >
      {delta !== undefined && (
        <span
          key={`${value}`}
          aria-hidden
          className={`demo-flash pointer-events-none absolute inset-0 ${delta > ZERO ? "bg-emerald-400/25 dark:bg-emerald-500/20" : "bg-rose-400/25 dark:bg-rose-500/20"}`}
        />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone[id]}`} />
          <span className="truncate">{copy.name}</span>
        </p>
        {delta !== undefined && (
          <span
            key={`${delta}`}
            data-testid="demo-delta"
            className={`demo-pop shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums ${
              delta > ZERO ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg"
            }`}
          >
            {delta > ZERO ? "+" : "−"}
            {thb(delta)}
          </span>
        )}
      </div>
      <p className="relative truncate text-[13px] text-subtle hidden tall:block">{copy.note}</p>
      {value === undefined ? (
        <p className="relative mt-0.5 text-sm text-subtle">{"empty" in copy ? copy.empty : "…"}</p>
      ) : (
        <div className="relative mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-xl font-semibold tabular-nums xl:text-2xl">{thb(value)}</span>
          <span className="text-[13px] tabular-nums text-subtle">
            {formatUsdt(value)} mUSDT{usd !== null && ` · ${formatFiat(usd, "USD")}`}
          </span>
        </div>
      )}
    </div>
  );
}

function RefereeCard({ id, active }: { id: "arbiter" | "inspector"; active: boolean }) {
  const copy = actorCards[id];
  return (
    <div className={`${cardBase} ${ring(active)} px-3 py-2`} data-testid={`demo-actor-${id}`} data-active={active ? "true" : "false"}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone[id]}`} />
        {copy.name}
      </p>
      <p className="text-[13px] leading-snug text-subtle">{copy.note}</p>
    </div>
  );
}

/** "Tenant −฿36,000 → Escrow contract +฿36,000": the money that moved in the current step. Mints come from the faucet. */
export function FlowStrip({ base, wallets }: { base: Wallets | null; wallets: Wallets | null }) {
  const thb = useThb();
  const d = deltas(base, wallets);
  const keys = Object.keys(d) as WalletKey[];
  const from = keys.filter((k) => d[k]! < ZERO);
  const to = keys.filter((k) => d[k]! > ZERO);
  const minted = keys.reduce((s, k) => s + d[k]!, ZERO); // > 0 only when the faucet created tokens
  const chip = (label: string, v: bigint, k: string) => (
    <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/70 px-2.5 py-0.5 dark:bg-slate-900/60">
      <span className="font-medium">{label}</span>
      <span className={`font-semibold tabular-nums ${v > ZERO ? "text-success" : "text-danger"}`}>
        {v > ZERO ? "+" : "−"}
        {thb(v)}
      </span>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base" data-testid="demo-flow" data-moves={keys.length}>
      <span className="text-sm font-semibold uppercase tracking-wide opacity-70">{panels.moved}</span>
      {keys.length === 0 ? (
        <span className="text-sm opacity-70">{panels.nothingMoved}</span>
      ) : (
        <>
          {minted > ZERO && chip(actorCards.faucet, -minted, "faucet")}
          {from.map((k) => chip(actorCards[k].name, d[k]!, k))}
          <span aria-hidden className="text-lg font-semibold">
            →
          </span>
          {to.map((k) => chip(actorCards[k].name, d[k]!, k))}
        </>
      )}
    </div>
  );
}
