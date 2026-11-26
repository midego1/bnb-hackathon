"use client";

import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { TOKEN } from "@/lib/contracts";
import { explorerLink } from "@/lib/chains";
import { useT } from "@/lib/i18n/client";
import { eventLabel, type JudgeStep, type StageStatus } from "@/lib/stage";
import "./ios.css";

/**
 * The judge's phone as the KeyScrow iPhone app draws it (the iOS app in ios/: Design/Theme + Components, Features/Rent),
 * for the phone inside /duo: rounded cards with an icon tile, the 7-dot step row, amounts with their mUSDT, the split
 * bar and the on-chain transactions. Markup and CSS only; JudgeFlow keeps the flow.
 */

/** JudgeFlow's step -> the app's 7 dots (Money · Pay · Pickup · Return · AI check · Accept · Settled). */
const DOT: Partial<Record<JudgeStep, number>> = { wallet: 0, money: 0, rent: 1, fund: 1, pickup: 2, return: 3, inspect: 4, waiting: 5, settled: 6 };
const DOTS = ["money", "pay", "pickup", "return", "inspect", "accept", "settled"] as const;

export const usdt = (units: bigint) => `${Number(formatUnits(units, TOKEN.decimals)).toFixed(2)} ${TOKEN.symbol}`;

export function IosSteps({ step }: { step: JudgeStep }) {
  const t = useT();
  const at = DOT[step] ?? -1; // "busy" is not a step: no dot is current
  const done = step === "settled";
  return (
    <ol className="ios-steps" aria-label={at >= 0 ? t("judge.ios.progress", { n: at + 1, name: t(`judge.ios.step.${DOTS[at]}`) }) : undefined} data-testid="ios-steps">
      {DOTS.map((k, i) => {
        const state = done || i < at ? "done" : i === at ? "current" : "todo";
        return (
          <li key={k} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="ios-dot">{state === "done" ? <Glyph d="M6 12.5l4 4 8-9" w={3} /> : i + 1}</span>
            <span className="ios-step-name">{t(`judge.ios.step.${k}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export type Tone = "amber" | "info" | "success" | "warning" | "neutral";

/** A step card: the rounded surface with its icon tile and the title (the app's `card(icon, title)`). */
export function IosCard({ icon, tone = "amber", title, children }: { icon: keyof typeof ICON; tone?: Tone; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="ios-card">
      <div className="flex items-center gap-3">
        <span className="ios-tile" data-tone={tone}>
          <Glyph d={ICON[icon]} />
        </span>
        <h2 className="ios-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Label left, baht right with its mUSDT under it (the app's KVRow). */
export function KV({ label, thb, units, strong }: { label: ReactNode; thb: string; units?: bigint; strong?: boolean }) {
  return (
    <div className="ios-kv" data-strong={strong || undefined}>
      <dt>{label}</dt>
      <dd>
        {thb}
        {units !== undefined && <small>{usdt(units)}</small>}
      </dd>
    </div>
  );
}

/** Coloured shares of one bar, with a legend (the app's SplitBar). */
export function SplitBar({ parts }: { parts: { id: "back" | "owner" | "fee"; label: string; value: bigint; text: string }[] }) {
  const shown = parts.filter((p) => p.value > BigInt(0));
  return (
    <div className="flex flex-col gap-2.5" data-testid="ios-split">
      <div className="ios-bar" aria-hidden>
        {shown.map((p) => (
          <i key={p.id} data-kind={p.id} style={{ flexGrow: Number(formatUnits(p.value, TOKEN.decimals)) }} />
        ))}
      </div>
      <ul className="ios-legend">
        {shown.map((p) => (
          <li key={p.id}>
            <i data-kind={p.id} aria-hidden />
            {p.label} <b>{p.text}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The big green tick of the settled card. */
export const SuccessCheck = () => (
  <span className="ios-success" aria-hidden>
    <Glyph d="M6 12.5l4 4 8-9" w={2.6} />
  </span>
);

/** One row of a transaction: numbered (or ticked) badge, what it was, the short hash, the arrow to the explorer. */
export function TxRow({ n, label, hash, chainId }: { n?: number; label: string; hash: string; chainId: number }) {
  const href = explorerLink(chainId, "tx", hash);
  const body = (
    <>
      <span className="ios-txn" data-done={n === undefined || undefined}>
        {n ?? <Glyph d="M6 12.5l4 4 8-9" w={2.6} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block leading-snug">{label}</span>
        <span className="block font-mono text-xs text-subtle">{`${hash.slice(0, 6)}…${hash.slice(-4)}`}</span>
      </span>
      {href && <Glyph d="M8 16L16 8M9 8h7v7" />}
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="ios-tx">
      {body}
    </a>
  ) : (
    <div className="ios-tx">{body}</div>
  );
}

/** "On-chain transactions": one row per transaction of this rental, numbered, oldest first. */
export function IosTxs({ status, chainId }: { status: StageStatus; chainId: number }) {
  const t = useT();
  const txs = status.events.filter((e, i, all) => all.findIndex((x) => x.txHash === e.txHash) === i);
  if (!txs.length) return null;
  const chain = explorerLink(chainId, "tx", "0x") ? (chainId === 97 ? "BSC testnet" : `BSC ${chainId}`) : t("duo.vault.local", { id: chainId });
  return (
    <section className="ios-card ios-receipt" data-testid="ios-txs">
      <p className="flex items-baseline justify-between gap-2">
        <b className="ios-headline">{t("judge.ios.txs")}</b>
        <span className="ios-kicker">{chain}</span>
      </p>
      <hr className="ios-rule" />
      {txs.map((e, i) => (
        <TxRow key={e.txHash} n={i + 1} label={eventLabel(e, t)} hash={e.txHash} chainId={chainId} />
      ))}
      <hr className="ios-rule" />
      <p className="text-xs text-subtle">{t(`judge.ios.txsFoot.${txs.length === 1 ? "one" : "other"}`, { n: txs.length, chain })}</p>
    </section>
  );
}

/** The phone's status bar and Dynamic Island, drawn over the top of a framed phone screen (390 CSS px wide). */
export const StatusBar = () => (
  <div className="ios-statusbar" aria-hidden>
    <span>09:41</span>
    <i className="ios-island" />
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 18 12" width={18} height={12} fill="currentColor">
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
        <rect x="10" y="3" width="3" height="9" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" />
      </svg>
      <svg viewBox="0 0 16 12" width={16} height={12} fill="currentColor">
        <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.2 10.2 0 0 0 8 .4 10.2 10.2 0 0 0 .8 3.3L2 4.6a8.5 8.5 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.5 1.4l1.2-1.3A6.8 6.8 0 0 0 8 4a6.8 6.8 0 0 0-4.7 1.9l1.2 1.3c1-.9 2.2-1.4 3.5-1.4Zm0 3.5c-.5 0-1 .2-1.3.5L8 11.2l1.3-1.4c-.3-.3-.8-.5-1.3-.5Z" />
      </svg>
      <svg viewBox="0 0 27 13" width={27} height={13}>
        <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4" />
        <rect x="2" y="2" width="20" height="9" rx="2.2" fill="currentColor" />
        <path d="M25 4.5v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity=".45" />
      </svg>
    </span>
  </div>
);

/** The icons the cards use (24-unit grid, round strokes, like the SF Symbols they stand for). */
export const ICON = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  drop: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z",
  key: "M14.5 9.5a4 4 0 1 0-3.2 3.9L13 15h2v2h2v2h3v-3l-5.6-5.6c.07-.3.1-.6.1-.9ZM9 8.5h.01",
  camera: "M4 8a1 1 0 0 1 1-1h3l1.5-2h5L16 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  back: "M4 8a1 1 0 0 1 1-1h3l1.5-2h5L16 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm5.5 4.5a2.8 2.8 0 0 1 5-1.5M14.5 9.5v1.7h-1.7M14.5 14a2.8 2.8 0 0 1-5 1.5M9.5 17v-1.7h1.7",
  sparkles: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
  hourglass: "M7 3h10M7 21h10M8 3v3.5L12 12l4-5.5V3M8 21v-3.5L12 12l4 5.5V21",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5",
  /** Filled: the catalogue's "Deposit protected by escrow". */
  shield: "M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6l7-3Z",
} as const;

export function Glyph({ d, w = 2 }: { d: string; w?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d={d} />
    </svg>
  );
}
