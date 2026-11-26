"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { DemoPersona } from "@/components/DemoPersona";
import { TxLink } from "@/components/roles/shared";
import { AddressTag, Card, Notice, Skeleton, useMoney } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import type { WalletHistory } from "@/lib/server/history";

/** wallet_history as it comes over /api/v1 (bigints as decimal strings). */
type Json<T> = T extends bigint ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type History = Json<WalletHistory>;

async function fetchHistory(wallet: string, chainId: number, signal: AbortSignal): Promise<History> {
  const res = await fetch(`/api/v1/wallet_history?${new URLSearchParams({ wallet, chainId: String(chainId) })}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`wallet_history ${res.status}`);
  return res.json();
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
const share = (part: string, total: string) => (BigInt(total) > BigInt(0) ? pct(Number((BigInt(part) * BigInt(10_000)) / BigInt(total))) : "0%");

/**
 * One party's history for a dispute (wallet_history): the on-chain facts, then what Living Brain remembers, each entry
 * with its transaction. `you`: the party's own card on their rental page ("what the dispute desk sees about you").
 * `lazy`: loads only when opened, so a plain page view never searches Living Brain (prepaid credit; the server caches
 * each wallet's read for 10 minutes too).
 */
export function WalletHistoryCard({ wallet, party, you = false, lazy = false }: { wallet: Address; party: "renter" | "owner"; you?: boolean; lazy?: boolean }) {
  const t = useT();
  const money = useMoney();
  const { chainId } = useDeployment();
  const [open, setOpen] = useState(!lazy);
  const { data, error } = useQuery({
    queryKey: ["walletHistory", chainId, wallet.toLowerCase()],
    queryFn: ({ signal }) => fetchHistory(wallet, chainId, signal),
    enabled: open,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const m = (v: string) => money(BigInt(v));
  const lease = (a: string) => (
    <Link href={`/lease/${a}`} className="font-mono underline decoration-dotted underline-offset-2">
      {shortAddress(a)}
    </Link>
  );

  return (
    <div data-testid="history-card" data-party={party} className="min-w-0">
      <Card title={t.h(you ? "history.you" : `history.${party}`)} aside={
          <span className="flex flex-wrap items-center justify-end gap-2">
            <DemoPersona address={wallet} />
            <AddressTag address={wallet} chainId={chainId} />
          </span>
        }
      >
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} data-testid="history-open" className="text-sm font-medium underline underline-offset-2">
            {t("history.show")}
          </button>
        ) : error ? (
          <Notice kind="warn">{t("history.error")}</Notice>
        ) : !data ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="space-y-4 text-sm">
            <Facts data={data} m={m} lease={lease} />
            <div data-testid="history-memory" data-provider={data.memory?.provider}>
              <h3 className="font-semibold">{t(data.memory?.provider === "local" ? "history.memoryLocal" : "history.memory")}</h3>
              {data.memory?.error && (
                <div className="mt-2">
                  <Notice kind="warn">{t(data.memory.limited ? "history.memoryLimited" : "history.memoryError")}</Notice>
                </div>
              )}
              {data.memory?.entries.length ? (
                <ul className="mt-2 space-y-2">
                  {data.memory.entries.map((e, i) => (
                    <li key={i} className="rounded-lg bg-muted p-2.5 text-xs [overflow-wrap:anywhere] text-muted-foreground" data-testid="history-entry">
                      <span className="mr-1.5 rounded bg-surface-strong px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                        {t(`history.source.${e.source}`)}
                      </span>
                      {e.text}
                      {e.txHash && (
                        <span className="ml-1.5 inline-block">
                          <TxLink hash={e.txHash as Hex} chainId={chainId} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                !data.memory?.error && <p className="mt-1 text-xs text-subtle">{t("history.memoryNone")}</p>
              )}
            </div>
            <p className="border-t border-border pt-3 text-xs text-subtle">
              <span className="font-medium text-muted-foreground">{t("history.note")}</span> {t("history.privacy")}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Facts({ data, m, lease }: { data: History; m: (v: string) => string; lease: (a: string) => ReactNode }) {
  const t = useT();
  const { asRenter: r, asOwner: o, disputes, claims, timeouts } = data.facts;
  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
  const counts = (s: { rentals: number; settled: number; disputes: number }) => `${s.rentals} · ${s.settled} · ${s.disputes}`;
  const role = (p: "renter" | "owner") => t(`history.role.${p}`);
  return (
    <div className="space-y-3" data-testid="history-facts">
      {!r.rentals && !o.rentals && <p className="text-subtle">{t("history.none")}</p>}
      {r.rentals > 0 && (
        <div className="space-y-1" data-testid="history-as-renter">
          <p className="font-semibold">{t("history.asRenter")}</p>
          <dl className="space-y-1">
            {row(`${t("history.rentals")} · ${t("history.settled")} · ${t("history.disputes")}`, counts(r))}
            {row(
              t("history.rent"),
              t("history.rentValue", {
                onTime: r.rentOnTime,
                late: r.rentLate,
                unpaid: r.rentUnpaid,
              }),
            )}
            {BigInt(r.depositSettled) > BigInt(0) &&
              row(
                t("history.depositBack"),
                t("history.ofTotal", {
                  part: m(r.depositBack),
                  total: m(r.depositSettled),
                  pct: share(r.depositBack, r.depositSettled),
                }),
              )}
          </dl>
        </div>
      )}
      {o.rentals > 0 && (
        <div className="space-y-1" data-testid="history-as-owner">
          <p className="font-semibold">{t("history.asOwner")}</p>
          <dl className="space-y-1">
            {row(`${t("history.rentals")} · ${t("history.settled")} · ${t("history.disputes")}`, counts(o))}
            {BigInt(o.depositSettled) > BigInt(0) &&
              row(
                t("history.kept"),
                t("history.ofTotal", {
                  part: m(o.depositKept),
                  total: m(o.depositSettled),
                  pct: share(o.depositKept, o.depositSettled),
                }),
              )}
            {row(t("history.repliesMissed"), o.repliesMissed)}
          </dl>
        </div>
      )}
      {(disputes.length > 0 || claims.length > 0 || timeouts.some((x) => x.kind === "owner-silent")) && (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground" data-testid="history-events">
          {disputes.map((d) => (
            <li key={`d${d.lease}`}>
              <Sentence text={t("history.dispute", { by: role(d.openedBy) })} lease={lease(d.lease)} />
              {d.outcome === "open"
                ? t("history.open")
                : d.outcome === "desk-late"
                  ? t("history.deskLate")
                  : t("history.ruled", {
                      renter: m(d.toRenter!),
                      owner: m(d.toOwner!),
                    })}
            </li>
          ))}
          {claims.map((c) => (
            <li key={`c${c.lease}`}>
              <Sentence text={t("history.claim", { owner: pct(c.ownerClaimBps) })} lease={lease(c.lease)} />
              {c.aiClaimBps === undefined
                ? t("history.noAi")
                : t(c.aiMock ? "history.demoAi" : "history.ai", {
                    pct: pct(c.aiClaimBps),
                  })}
            </li>
          ))}
          {timeouts
            .filter((x) => x.kind === "owner-silent")
            .map((x) => (
              <li key={`t${x.lease}`}>
                <Sentence text={t("history.ownerSilent")} lease={lease(x.lease)} />
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/** A dictionary sentence with a `{lease}` placeholder, rendered with the rental's link in its place. */
function Sentence({ text, lease }: { text: string; lease: ReactNode }) {
  const [before, after = ""] = text.split("{lease}");
  return (
    <>
      {before}
      {lease}
      {after}
    </>
  );
}

/** Both parties of a rental (dispute desk, disputed rental page). */
export function PartyHistories({ renter, owner, me }: { renter: Address; owner: Address; me?: string }) {
  const mine = (a: string) => !!me && a.toLowerCase() === me.toLowerCase();
  return (
    // Side by side where there is room (the dispute desk page), stacked in a narrow column (the rental page's side, a phone).
    <div className="@container min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @2xl:grid-cols-2" data-testid="party-histories">
        <WalletHistoryCard wallet={renter} party="renter" you={mine(renter)} />
        <WalletHistoryCard wallet={owner} party="owner" you={mine(owner)} />
      </div>
    </div>
  );
}
