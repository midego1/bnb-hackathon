"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { zeroHash } from "viem";
import { ActionButton, Notice } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { evidenceUrl } from "@/lib/evidence";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/t";
import { shortAddress } from "@/lib/format";
import type { Listing } from "@/lib/listings";
import { eventLabel, MAINNET_STAGE_CHAIN_ID, same, stageTerms, thbText, type StageStatus } from "@/lib/stage";
import { stageAction, useStageStatus } from "./client";
import { subscribeNothing } from "./wallet";

// The QR encoder loads after the page, not with it (here and in /duo).
export const Qr = dynamic(() => import("./Qr"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-white/80" /> });

const PHONE = "(max-width: 639px)";
const subscribeMedia = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

const CODE_KEY = "keyescrow.stage.presenterCode";
export const big = (u: bigint, s?: StageStatus) => thbText(u, s?.price.thbPerUsdt ?? 33);

/** What is happening now, in one line for the back of the room (a headline: Chinese line under it in EN+中文). */
export function headline(s: StageStatus, t: T): ReactNode {
  const l = s.lease;
  if (s.creating) return t.h("stage.creating");
  if (!l || l.status === "Cancelled") return t.h("stage.scan", { name: s.listing.name });
  switch (l.status) {
    case "Created":
      return t.h("stage.created");
    case "Active":
      if (l.checkInHash === zeroHash) return t.h("stage.locked", { amount: big(l.terms.depositAmount + l.terms.rentAmount, s) });
      if (l.checkOutHash === zeroHash) return t.h("stage.pickedUp");
      return t.h("stage.returned");
    case "MoveOut":
      return t.h("stage.proposed", { back: big(l.proposal.tenantRefund, s), kept: big(l.proposal.landlordClaim, s) });
    case "Disputed":
      return t.h("stage.disputed");
    case "Settled":
      return t.h("stage.settled");
  }
}

/**
 * The owner's side of the live rental, shared by the big screen and /duo: the polled status, the money it moved and
 * the presenter's Accept / Reset (behind the presenter code when the server sets one).
 */
export function useOwnerSide(slug: string) {
  const { status: s, offline, refresh } = useStageStatus(slug);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const t = useT();

  async function presenter(action: "accept" | "reset") {
    if (action === "reset" && !window.confirm(t("stage.presenter.resetConfirm"))) return;
    let code: string | undefined;
    try {
      code = localStorage.getItem(CODE_KEY) ?? undefined;
    } catch {}
    if (s?.presenterLocked && !code) {
      code = window.prompt(t("stage.presenter.code")) ?? undefined;
      try {
        if (code) localStorage.setItem(CODE_KEY, code);
      } catch {}
    }
    setBusy(action);
    setError(undefined);
    try {
      await stageAction(slug, { action, code });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/presenter code/i.test(msg)) localStorage.removeItem(CODE_KEY);
      setError(msg);
    } finally {
      setBusy(undefined);
    }
  }

  const l = s?.lease;
  const funded = s?.events.find((e) => e.name === "Funded");
  const settled = s?.events.findLast((e) => e.name === "Settled");
  const sa = settled?.args as Record<string, bigint> | undefined;
  return {
    s,
    l,
    offline,
    busy,
    error,
    presenter,
    paid: funded ? (funded.args.deposit as bigint) + (funded.args.firstRent as bigint) : undefined,
    fee: sa?.fee,
    toOwner: sa ? sa.landlordClaim + sa.rentToLandlord - sa.fee : undefined,
    back: sa ? sa.tenantRefund + sa.rentToTenant : undefined,
    photos: (kind: number) => (s?.events ?? []).filter((e) => e.name === "EvidenceAdded" && Number(e.args.kind) === kind).map((e) => String(e.args.contentHash)),
    canAccept: l?.status === "MoveOut" && same(l.proposal.proposer, s?.rental?.renter),
    rows: (s?.events ?? []).filter((e) => e.name !== "PayeeSet"),
  };
}
export type OwnerSide = ReturnType<typeof useOwnerSide>;

/** A scroll box that keeps its newest (last) row in view as rows come in. */
export function useNewestInView(rows: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);
  return ref;
}

/** The big-screen presenter view (/stage/<slug>): QR to the phone flow, the rental live, and the owner's buttons. */
export function StageView({ listing, chainId }: { listing: Listing; chainId: number }) {
  const o = useOwnerSide(listing.slug);
  const { s, l, offline, paid, fee, toOwner, back, photos, rows } = o;
  const url = useSyncExternalStore(subscribeNothing, () => `${window.location.origin}/r/${listing.slug}`, () => "");
  const t = useT();
  // Phones get the timeline folded away (under the money and the QR); bigger screens show it all, newest row in view.
  const phone = useSyncExternalStore(subscribeMedia, () => window.matchMedia(PHONE).matches, () => false);
  const timelineRef = useNewestInView(rows.length);
  const link = (kind: "tx" | "address", v: string) => explorerLink(chainId, kind, v);
  const timeline = <Timeline rows={rows} chainId={chainId} className="text-base sm:text-lg wide:text-[clamp(1.125rem,0.6rem+0.8vw,1.875rem)]" />;

  /*
   * Stacked (phone, iPad portrait): title, status, money 2x2, QR card, photos, timeline, presenter bar sticky at the
   * bottom. `wide` (landscape, >= 1024px: iPad landscape, laptop, projector): QR left, story right, type scaled with
   * clamp(); with `stage` (at least 720px tall) it is one screen and only the timeline scrolls. The two column divs are
   * `display: contents` when stacked, so `order-*` puts their children in the stacked order.
   */
  return (
    <main
      className="flex min-h-dvh flex-col gap-4 px-4 pt-4 sm:gap-5 sm:px-6 sm:pt-6 wide:grid wide:grid-cols-[minmax(0,clamp(17rem,24vw,34rem))_minmax(0,1fr)] wide:gap-[clamp(1.5rem,2.5vw,4rem)] wide:p-[clamp(1.25rem,2.5vw,4rem)] wide:stage:h-dvh wide:stage:grid-rows-[minmax(0,1fr)]"
      data-testid="stage-view"
      data-status={l?.status ?? "none"}
    >
      <div className="contents wide:flex wide:min-h-0 wide:flex-col wide:items-center wide:gap-[clamp(0.75rem,2vh,1.5rem)] wide:text-center">
        <header data-testid="stage-title" className="order-1 flex items-center gap-3 wide:flex-col wide:gap-[clamp(0.5rem,1.5vh,1.25rem)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static listing photo */}
          <img src={listing.photos[0]} alt={listing.name} className="size-14 shrink-0 rounded-xl object-cover sm:size-20 wide:aspect-[4/3] wide:h-[clamp(6rem,20vh,18rem)] wide:w-auto wide:max-w-full wide:rounded-2xl" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl wide:text-[clamp(1.875rem,0.8rem+1.9vw,4rem)] wide:leading-tight">{listing.name}</h1>
            <p className="text-base text-muted-foreground sm:text-lg wide:mt-1 wide:text-[clamp(1.125rem,0.5rem+1vw,2rem)]">
              {t("stage.terms", stageTerms(listing, chainId))}
            </p>
            {chainId === MAINNET_STAGE_CHAIN_ID && (
              <p className="text-sm font-semibold text-warning-fg sm:text-base wide:text-[clamp(1rem,0.4rem+0.8vw,1.75rem)]" data-testid="stage-real-money">
                {t("stage.realMoney")}
              </p>
            )}
          </div>
        </header>

        <section data-testid="stage-qr-card" className="order-4 flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-center wide:my-auto wide:w-full wide:border-0 wide:bg-transparent wide:p-0">
          <div className="aspect-square w-[min(100%,15rem)] rounded-2xl bg-white p-2 sm:w-[min(100%,18rem)] wide:w-[min(100%,clamp(12rem,38vh,34rem))] wide:p-3">
            {url && <Qr text={url} label={t("stage.qr", { url })} />}
          </div>
          <p className="max-w-full break-all font-mono text-sm sm:text-base wide:text-[clamp(0.875rem,0.3rem+0.8vw,1.75rem)]" data-testid="stage-url">
            {url.replace(/^https?:\/\//, "")}
          </p>
          <a href={`/r/${listing.slug}`} className="inline-flex min-h-11 items-center px-2 text-sm text-info underline wide:hidden" data-testid="stage-open-here">
            {t("stage.openHere")}
          </a>
        </section>
      </div>

      <div className="contents wide:flex wide:min-h-0 wide:min-w-0 wide:flex-col wide:gap-[clamp(1rem,2.2vh,2rem)]">
        {offline && (
          <div className="order-2">
            <Notice kind="warn">{t("stage.offline")}</Notice>
          </div>
        )}
        <h2 className="order-2 text-2xl font-semibold leading-tight sm:text-3xl wide:text-[clamp(1.75rem,0.75rem+2vw,4rem)]" data-testid="stage-headline">
          {s ? headline(s, t) : t("stage.loading")}
        </h2>

        <div className="order-3 grid grid-cols-2 gap-3 wide:grid-cols-4 wide:gap-[clamp(0.75rem,1vw,1.5rem)]" data-testid="stage-money">
          <Money label={t("stage.money.paid")} value={paid !== undefined ? big(paid, s) : "–"} sub={s?.rental && shortAddress(s.rental.renter)} href={s?.rental && link("address", s.rental.renter)} />
          <Money label={t("stage.money.escrow")} value={l ? big(l.balance, s) : "–"} sub={l && shortAddress(l.address)} href={l && link("address", l.address)} strong />
          <Money label={t("stage.money.owner")} value={toOwner !== undefined ? big(toOwner, s) : "–"} sub={s && shortAddress(s.owner)} href={s && link("address", s.owner)} />
          <Money label={t("stage.money.back")} value={back !== undefined ? big(back, s) : "–"} sub={fee !== undefined ? t("stage.money.fee", { fee: big(fee, s) }) : undefined} />
        </div>

        {(photos(0).length > 0 || photos(1).length > 0) && (
          <div className="order-5 flex flex-wrap gap-4 wide:gap-6" data-testid="stage-photos">
            <Photos title={t("stage.photos.pickup")} hashes={photos(0)} />
            <Photos title={t("stage.photos.return")} hashes={photos(1)} />
          </div>
        )}

        <div ref={timelineRef} data-testid="stage-timeline-box" className="order-6 wide:min-h-0 wide:flex-1 wide:overflow-y-auto">
          {phone ? (
            <details className="rounded-2xl border border-border bg-surface px-4">
              <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium" data-testid="stage-timeline-toggle">
                {t("stage.timeline")} ({rows.length})
              </summary>
              <div className="pb-3">{timeline}</div>
            </details>
          ) : (
            timeline
          )}
        </div>

        <div className="sticky bottom-0 order-7 -mx-4 mt-auto flex flex-wrap items-start gap-3 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6 wide:static wide:mx-0 wide:border-0 wide:bg-transparent wide:p-0 wide:backdrop-blur-none [&_button]:min-h-12 [&_button]:px-4 [&_button]:text-base sm:[&_button]:min-h-14 sm:[&_button]:px-6 sm:[&_button]:text-lg wide:[&_button]:min-h-[clamp(3.5rem,6.5vh,5.5rem)] wide:[&_button]:px-[clamp(1.5rem,1.6vw,2.5rem)] wide:[&_button]:text-[clamp(1.125rem,0.4rem+0.85vw,2rem)] wide:[&_p]:text-[clamp(0.75rem,0.3rem+0.45vw,1.125rem)]" data-testid="stage-presenter">
          <PresenterButtons o={o} />
        </div>
      </div>
    </main>
  );
}

export function Money({ label, value, sub, href, strong }: { label: string; value: string; sub?: ReactNode; href?: string; strong?: boolean }) {
  return (
    <div className={`@container min-w-0 rounded-2xl border p-3 sm:p-4 ${strong ? "border-info-border bg-info-soft" : "border-border bg-surface"}`}>
      <div className="text-sm text-muted-foreground sm:text-base wide:text-[clamp(1rem,0.5rem+0.6vw,1.5rem)]">{label}</div>
      {/* Sized to the card (cqi), never wrapped: "฿10,000" always fits on one line. */}
      <div className="whitespace-nowrap text-[clamp(1.25rem,21cqi,4.5rem)] font-bold leading-tight tabular-nums" data-testid="stage-amount">{value}</div>
      {sub &&
        (href ? (
          <a href={href} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-subtle underline sm:text-sm wide:text-[clamp(0.875rem,0.3rem+0.55vw,1.375rem)] pointer-coarse:py-3.5">
            {sub}
          </a>
        ) : (
          <div className="truncate font-mono text-xs text-subtle sm:text-sm wide:text-[clamp(0.875rem,0.3rem+0.55vw,1.375rem)]">{sub}</div>
        ))}
    </div>
  );
}

export function Photos({ title, hashes }: { title: string; hashes: string[] }) {
  const t = useT();
  if (!hashes.length) return null;
  return (
    <figure>
      <figcaption className="mb-1 text-base text-muted-foreground sm:text-lg wide:text-[clamp(1rem,0.5rem+0.6vw,1.5rem)]">{title}</figcaption>
      <div className="flex gap-2">
        {hashes.map((h) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={h} src={evidenceUrl(h)} alt={t("stage.photos.alt", { title })} className="size-20 rounded-lg bg-muted object-cover sm:size-24 wide:size-[clamp(5rem,12vh,9rem)]" />
        ))}
      </div>
    </figure>
  );
}

/** The rental's on-chain events in plain words, each with its BscScan link (a local chain shows the hash only). */
export function Timeline({ rows, chainId, className }: { rows: OwnerSide["rows"]; chainId: number; className: string }) {
  const t = useT();
  return (
    <ol className={`flex flex-col gap-2 ${className}`} data-testid="stage-timeline">
      {rows.map((e) => {
        const href = explorerLink(chainId, "tx", e.txHash);
        return (
          <li key={`${e.txHash}:${e.logIndex}`} className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
            <span className="min-w-0">{eventLabel(e, t)}</span>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center font-mono text-[0.75em] text-info underline pointer-coarse:min-h-11">
                BscScan {e.txHash.slice(0, 8)}…
              </a>
            ) : (
              <span className="shrink-0 font-mono text-[0.75em] text-subtle">{e.txHash.slice(0, 10)}…</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The presenter's Accept (owner) and Reset buttons, with the last error under them. */
export function PresenterButtons({ o }: { o: OwnerSide }) {
  const t = useT();
  return (
    <>
      <ActionButton className="min-w-0 flex-1 wide:flex-none" busy={o.busy === "accept"} disabledReason={!o.canAccept ? t("stage.presenter.acceptWhen") : undefined} onClick={() => o.presenter("accept")} data-testid="stage-accept">
        {t("stage.presenter.accept")}
      </ActionButton>
      <ActionButton className="shrink-0" variant="secondary" busy={o.busy === "reset"} onClick={() => o.presenter("reset")} data-testid="stage-reset">
        {t("stage.presenter.reset")}
      </ActionButton>
      {o.error && (
        <div className="basis-full">
          <Notice kind="error">{o.error}</Notice>
        </div>
      )}
    </>
  );
}
