"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Notice } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { formatFiat } from "@/lib/fiat";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { Listing } from "@/lib/listings";
import { duoStep } from "@/lib/stage";
import { big, headline, Money, Photos, PresenterButtons, Qr, Timeline, useNewestInView, useOwnerSide } from "./StageView";
import { subscribeNothing } from "./wallet";

/** The phone the renter pane draws: an iPhone-sized viewport (CSS px), scaled to fit, inside a bezel. */
const W = 390;
const H = 844;
const BEZEL = 10;
const STEPS = ["rent", "pickup", "return", "split", "settled"] as const;

/**
 * /duo/<slug>, for the pitch and the video: the renter's phone (the real /r flow, framed) left and the rental company's
 * view of the same rental right (the /stage pieces), under a step bar. Laptop and projector: one screen, nothing
 * scrolls but the timeline. Phones: stacked, with a note that it is best on a laptop.
 */
export function DuoView({ listing, chainId }: { listing: Listing; chainId: number }) {
  const o = useOwnerSide(listing.slug);
  const { s, l, offline, paid, fee, toOwner, back, photos, rows } = o;
  const url = useSyncExternalStore(subscribeNothing, () => `${window.location.origin}/r/${listing.slug}`, () => "");
  const timelineRef = useNewestInView(rows.length);
  const t = useT();
  const at = duoStep(s);
  const link = (kind: "tx" | "address", v: string) => explorerLink(chainId, kind, v);
  const [pickup, dropoff] = [photos(0), photos(1)];
  const money = (u: bigint | undefined) => (u !== undefined ? big(u, s) : "–");

  return (
    <main
      className="flex min-h-dvh flex-col gap-3 p-3 sm:p-4 wide:stage:h-dvh wide:stage:gap-[clamp(0.75rem,1.6vh,1.5rem)] wide:stage:p-[clamp(0.75rem,1.4vw,2rem)]"
      data-testid="duo-view"
      data-status={l?.status ?? "none"}
      data-step={at}
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static listing photo */}
          <img src={listing.photos[0]} alt="" className="size-10 shrink-0 rounded-lg object-cover wide:size-[clamp(2.5rem,4.5vh,3.5rem)]" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight wide:text-[clamp(1.125rem,0.5rem+0.8vw,1.875rem)]">{t.h("duo.title")}</h1>
            <p className="truncate text-sm text-muted-foreground wide:text-[clamp(0.875rem,0.4rem+0.45vw,1.25rem)]">
              {listing.name} · {t("stage.terms", { rent: formatFiat(listing.rentThb, "THB"), deposit: formatFiat(listing.depositThb, "THB") })}
            </p>
          </div>
        </div>
        <ol aria-label={t("duo.steps")} className="flex min-w-0 flex-1 items-center gap-2 wide:min-w-[36rem]" data-testid="duo-steps">
          {STEPS.map((key, i) => {
            const n = i + 1;
            const state = n < at || at === 5 ? "done" : n === at ? "current" : "todo";
            return (
              <li key={key} className={`flex min-w-0 flex-1 items-center gap-2 ${n === at ? "max-sm:flex-none" : ""}`} aria-current={n === at ? "step" : undefined} data-state={state}>
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold wide:size-[clamp(1.75rem,3.2vh,2.5rem)] wide:text-[clamp(0.875rem,0.4rem+0.4vw,1.25rem)] ${
                    state === "done" ? "bg-success text-white" : state === "current" ? "bg-primary text-primary-foreground ring-4 ring-ring/40" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {state === "done" ? "✓" : n}
                </span>
                <span
                  className={`min-w-0 text-sm leading-tight wide:text-[clamp(0.875rem,0.4rem+0.45vw,1.25rem)] ${n === at ? "font-semibold text-foreground" : "text-muted-foreground max-sm:sr-only"}`}
                >
                  {t.h(`duo.step.${key}`)}
                </span>
                {n < 5 && <span aria-hidden className={`hidden h-0.5 min-w-3 flex-1 rounded sm:block ${n < at || at === 5 ? "bg-success" : "bg-border"}`} />}
              </li>
            );
          })}
        </ol>
      </header>

      <div className="wide:hidden">
        <Notice>{t("duo.best")}</Notice>
      </div>

      <div className="flex flex-col gap-4 wide:grid wide:grid-cols-[auto_minmax(0,1fr)] wide:stage:min-h-0 wide:stage:flex-1 wide:stage:grid-cols-[minmax(0,calc((100dvh_-_9rem)*0.47))_minmax(0,1fr)] wide:stage:grid-rows-[minmax(0,1fr)] wide:gap-[clamp(1rem,1.6vw,2.5rem)]">
        <section aria-labelledby="duo-renter-label" className="flex min-w-0 flex-col items-center gap-2 wide:stage:min-h-0" data-testid="duo-renter">
          <PaneLabel id="duo-renter-label">{t.h("duo.renter")}</PaneLabel>
          <Phone src={`/r/${listing.slug}?duo=1`} title={t("duo.phone")} />
        </section>

        <section aria-labelledby="duo-owner-label" className="flex min-w-0 flex-col gap-3 rounded-3xl border border-border bg-surface/60 p-3 sm:p-4 wide:stage:min-h-0 wide:stage:gap-[clamp(0.75rem,1.6vh,1.5rem)] wide:stage:p-[clamp(1rem,1.4vw,2rem)]" data-testid="duo-owner">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <PaneLabel id="duo-owner-label">{t.h("duo.owner")}</PaneLabel>
              <p className="mt-1 text-xl font-semibold leading-tight sm:text-2xl wide:text-[clamp(1.25rem,0.5rem+1.2vw,2.75rem)]" data-testid="stage-headline">
                {s ? headline(s, t) : t("stage.loading")}
              </p>
            </div>
            <figure className="flex shrink-0 flex-col items-center gap-1 text-center" data-testid="stage-qr-card">
              <div className="size-24 rounded-lg bg-white p-1 sm:size-28 wide:size-[clamp(5.5rem,13vh,10rem)]">{url && <Qr text={url} label={t("stage.qr", { url })} />}</div>
              <figcaption className="max-w-[10rem] text-xs text-muted-foreground wide:max-w-[clamp(6rem,13vh,10rem)] wide:text-[clamp(0.75rem,0.3rem+0.35vw,1rem)]">{t("duo.scan")}</figcaption>
            </figure>
          </div>

          {offline && <Notice kind="warn">{t("stage.offline")}</Notice>}

          {s && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)]" data-testid="stage-money">
              <Moving value={money(paid)}>
                <Money label={t("stage.money.paid")} value={money(paid)} sub={s.rental && shortAddress(s.rental.renter)} href={s.rental && link("address", s.rental.renter)} />
              </Moving>
              <Flow moving={money(paid)} />
              <Moving value={money(l?.balance)}>
                <Money label={t("stage.money.escrow")} value={money(l?.balance)} sub={l && shortAddress(l.address)} href={l && link("address", l.address)} strong />
              </Moving>
              <Flow moving={money(toOwner)} />
              <Moving value={money(toOwner)}>
                <Money label={t("stage.money.owner")} value={money(toOwner)} sub={shortAddress(s.owner)} href={link("address", s.owner)} />
              </Moving>
              <Moving value={money(back)}>
                <Money label={t("stage.money.back")} value={money(back)} sub={fee !== undefined ? t("stage.money.fee", { fee: big(fee, s) }) : undefined} />
              </Moving>
            </div>
          )}

          <div className={`flex flex-col gap-3 wide:stage:min-h-0 wide:stage:flex-1 ${pickup.length || dropoff.length ? "sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)] sm:gap-5" : ""}`}>
            {(pickup.length > 0 || dropoff.length > 0) && (
              <div className="flex flex-wrap content-start gap-4" data-testid="stage-photos">
                <Photos title={t("stage.photos.pickup")} hashes={pickup} />
                <Photos title={t("stage.photos.return")} hashes={dropoff} />
              </div>
            )}
            <div ref={timelineRef} className="max-h-80 overflow-y-auto wide:stage:max-h-none wide:stage:min-h-0" data-testid="stage-timeline-box">
              <Timeline rows={rows} chainId={chainId} className="text-base wide:text-[clamp(0.9375rem,0.4rem+0.55vw,1.5rem)]" />
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-3 [&_button]:min-h-12 [&_button]:px-5 [&_button]:text-base wide:[&_button]:min-h-[clamp(3rem,5.5vh,4.5rem)] wide:[&_button]:text-[clamp(1rem,0.4rem+0.6vw,1.625rem)]" data-testid="stage-presenter">
            <PresenterButtons o={o} />
          </div>
        </section>
      </div>
    </main>
  );
}

function PaneLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground wide:text-[clamp(0.875rem,0.4rem+0.45vw,1.25rem)]">
      {children}
    </h2>
  );
}

/** The renter's phone: /r framed at a phone's 390x844 CSS px, scaled down (or up) to the room the pane has. */
function Phone({ src, title }: { src: string; title: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = slot.current!;
    const fit = () => setScale(Math.min((el.clientWidth - 2 * BEZEL) / W, (el.clientHeight - 2 * BEZEL) / H));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    // Stacked: the slot is phone-shaped and as wide as the screen allows; one-screen: it is the pane's whole height.
    <div ref={slot} className="flex aspect-[410/864] w-full max-w-[410px] justify-center wide:stage:aspect-auto wide:stage:min-h-0 wide:stage:max-w-none wide:stage:flex-1">
      {scale > 0 && (
        <div data-testid="duo-phone" className="shrink-0 overflow-hidden rounded-[2.25rem] bg-neutral-900 shadow-xl dark:bg-neutral-700 ring-1 ring-border-strong" style={{ width: W * scale + 2 * BEZEL, height: H * scale + 2 * BEZEL, padding: BEZEL }}>
          <div className="relative size-full overflow-hidden rounded-[1.6rem] bg-background">
            <iframe src={src} title={title} width={W} height={H} className="absolute top-0 left-0 origin-top-left border-0" style={{ transform: `scale(${scale})` }} data-testid="duo-phone-frame" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Counts the times `value` changed to an amount since the pane mounted (the first state shown is not a move). */
function useMoves(value: string) {
  const [last, setLast] = useState(value);
  const [moves, setMoves] = useState(0);
  if (value !== last) {
    setLast(value);
    if (value !== "–") setMoves(moves + 1);
  }
  return moves;
}

/** A money card that lights up briefly when its amount changes (demo-flash: off with reduced motion). */
function Moving({ value, children }: { value: string; children: ReactNode }) {
  const moves = useMoves(value);
  return (
    <div className="relative grid">
      {children}
      {moves > 0 && <span key={moves} aria-hidden className="demo-flash pointer-events-none absolute inset-0 rounded-2xl bg-flash-up ring-2 ring-success" data-testid="duo-flash" />}
    </div>
  );
}

/** The arrow between two cards; a ฿ coin runs along it when money moves that way (static with reduced motion). */
function Flow({ moving }: { moving: string }) {
  const moves = useMoves(moving);
  return (
    <div aria-hidden className="relative hidden w-[clamp(1.75rem,2.6vw,3.5rem)] items-center sm:flex" data-testid="duo-flow" data-moving={moves > 0 || undefined}>
      <span className="h-0.5 w-full rounded bg-border-strong" />
      <span className="absolute right-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-border-strong" />
      {moves > 0 && (
        <span key={moves} className="duo-coin absolute top-1/2 grid size-[1.375rem] place-items-center rounded-full bg-warning text-xs font-bold text-black shadow">
          ฿
        </span>
      )}
    </div>
  );
}
