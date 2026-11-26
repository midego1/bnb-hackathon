"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { LogoMark } from "@/components/LogoMark";
import { ActionButton, Notice } from "@/components/ui";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { explorerLink } from "@/lib/chains";
import { evidenceUrl } from "@/lib/evidence";
import { formatFiat } from "@/lib/fiat";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { getListing, type Listing } from "@/lib/listings";
import { coinPlan, duoStep, eventLabel, moneyBoard, unitsToThb, type StageStatus } from "@/lib/stage";
import { DotNum, Track } from "@/components/marketing/MoneyBoard";
import { ExternalIcon, PassportIcon, ShopIcon } from "@/components/marketing/icons";
import { big, headline, Qr, useNewestInView, useOwnerSide, type OwnerSide } from "./StageView";
import { subscribeNothing } from "./wallet";
import "./duo.css";

/** The phones draw an iPhone-sized viewport (CSS px), scaled to fit, inside a bezel. */
const W = 390;
const H = 844;
const BEZEL = 10;
const STEPS = ["choose", "rent", "pickup", "return", "split", "settled"] as const;

/**
 * /duo/<slug>, for the pitch and the video: two phones and a vault. The renter's phone (the real /r flow, framed) left,
 * the shop owner's phone (this rental as the owner sees it, with the presenter's Accept) right, and between them the
 * escrow as a vault: the amount in LED coins, a coin pile that fills, colours at the split and drains at settlement,
 * and the on-chain receipt under it. Everything follows the live rental (chain state, polled). Laptop and projector:
 * one screen. Phones: stacked, with a note that it is best on a laptop.
 * The phone starts on its chooser (step 0) and posts what it picked: the header, owner side and URL follow that item.
 */
export function DuoView({ listing: first, chainId }: { listing: Listing; chainId: number }) {
  const [slug, setSlug] = useState(first.slug);
  const [choosing, setChoosing] = useState(true);
  const [phoneSrc] = useState(`/r/${first.slug}?duo=1`); // the phone navigates itself; reloading it would lose its place
  useEffect(() => {
    const onMessage = (e: MessageEvent<{ duoSlug?: unknown; choosing?: unknown }>) => {
      const to = e.data?.duoSlug;
      if (e.origin !== window.location.origin || typeof to !== "string" || !getListing(to)) return;
      setSlug(to);
      setChoosing(e.data.choosing === true);
      if (window.location.pathname !== `/duo/${to}`) window.history.replaceState(null, "", `/duo/${to}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const listing = getListing(slug) ?? first;
  const o = useOwnerSide(listing.slug);
  const { s, l, offline } = o;
  const url = useSyncExternalStore(subscribeNothing, () => `${window.location.origin}/r/${listing.slug}`, () => "");
  const t = useT();
  const at = choosing ? 0 : duoStep(s);

  return (
    <main
      className="duo flex min-h-dvh flex-col gap-3 p-3 sm:p-4 wide:stage:h-dvh wide:stage:gap-[clamp(0.5rem,1.2vh,1.25rem)] wide:stage:px-[clamp(0.75rem,1.4vw,2rem)] wide:stage:pt-[clamp(0.5rem,1.2vh,1.5rem)] wide:stage:pb-0"
      data-testid="duo-view"
      data-status={l?.status ?? "none"}
      data-step={at}
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static listing photo */}
          <img src={listing.photos[0]} alt="" className="size-10 shrink-0 rounded-lg object-cover wide:size-[clamp(2.5rem,4.5vh,3.5rem)]" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground wide:text-[clamp(0.875rem,0.4rem+0.45vw,1.25rem)]"><LogoMark className="size-6 shrink-0 wide:size-[clamp(1.5rem,3vh,2.25rem)]" />KeyScrow</p>
            <h1 className="text-lg font-bold leading-tight wide:text-[clamp(1.125rem,0.5rem+0.8vw,1.875rem)]">{t.h("duo.title")}</h1>
            <p className="truncate text-sm text-muted-foreground wide:text-[clamp(0.875rem,0.4rem+0.45vw,1.25rem)]">
              {listing.name} · {t("stage.terms", { rent: formatFiat(listing.rentThb, "THB"), deposit: formatFiat(listing.depositThb, "THB") })}
            </p>
          </div>
        </div>
        <ol aria-label={t("duo.steps")} className="flex min-w-0 flex-1 items-center gap-2 wide:min-w-[36rem]" data-testid="duo-steps">
          {STEPS.map((key, n) => {
            const state = n < at || at === 5 ? "done" : n === at ? "current" : "todo";
            return (
              <li key={key} className={`flex min-w-0 flex-1 items-center gap-2 ${n === at ? "max-sm:flex-none" : ""}`} aria-current={n === at ? "step" : undefined} data-state={state}>
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold wide:size-[clamp(1.75rem,3.2vh,2.5rem)] wide:text-[clamp(0.875rem,0.4rem+0.4vw,1.25rem)] ${
                    state === "done" ? "bg-success text-white" : state === "current" ? "bg-primary text-primary-foreground ring-4 ring-ring/40" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {state === "done" ? "✓" : n + 1}
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
      {offline && <Notice kind="warn">{t("stage.offline")}</Notice>}

      <div className="duo-grid">
        <section aria-labelledby="duo-renter-label" className="duo-side" data-testid="duo-renter">
          <PaneLabel id="duo-renter-label">{t.h("duo.renter")}</PaneLabel>
          <Phone testid="duo-phone">
            <iframe src={phoneSrc} title={t("duo.phone")} width={W} height={H} className="block border-0" data-testid="duo-phone-frame" />
          </Phone>
          <p className="duo-note text-[var(--duo-teal-fg)]">
            <PassportIcon />
            {t("duo.board.passport")}
          </p>
        </section>

        {s ? <Vault s={s} chainId={chainId} rows={o.rows} /> : <div />}

        <section aria-labelledby="duo-owner-label" className="duo-side" data-testid="duo-owner">
          <PaneLabel id="duo-owner-label">{t.h("duo.owner")}</PaneLabel>
          <Phone testid="duo-owner-phone">
            <OwnerScreen o={o} listing={listing} chainId={chainId} />
          </Phone>
          <p className="duo-note text-[var(--duo-pink-fg)]">{t("duo.shop.note")}</p>
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-border py-2 wide:stage:py-[clamp(0.4rem,0.9vh,0.75rem)]" data-testid="stage-presenter">
        <QrCard url={url} name={listing.name} />
        <div className="min-w-0 flex-1">{o.error && <Notice kind="error">{o.error}</Notice>}</div>
        <ActionButton className="shrink-0" variant="secondary" busy={o.busy === "reset"} onClick={() => o.presenter("reset")} data-testid="stage-reset">
          {t("stage.presenter.reset")}
        </ActionButton>
        {o.dialogs}
      </footer>
    </main>
  );
}

function PaneLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground wide:text-[clamp(0.8125rem,0.4rem+0.4vw,1.125rem)]">
      {children}
    </h2>
  );
}

/** A phone: its 390x844 CSS px screen scaled down (or up) to the room the column has, inside a bezel. */
function Phone({ testid, children }: { testid: string; children: ReactNode }) {
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
    // Stacked: the slot is phone-shaped and as wide as the screen allows; one-screen: it is the column's whole height.
    <div ref={slot} className="flex aspect-[410/864] w-full max-w-[410px] justify-center wide:stage:aspect-auto wide:stage:min-h-0 wide:stage:max-w-none wide:stage:flex-1">
      {scale > 0 && (
        <div data-testid={testid} className="shrink-0 overflow-hidden rounded-[2.25rem] bg-neutral-900 shadow-xl ring-1 ring-border-strong dark:bg-neutral-700" style={{ width: W * scale + 2 * BEZEL, height: H * scale + 2 * BEZEL, padding: BEZEL }}>
          <div className="relative size-full overflow-hidden rounded-[1.6rem] bg-background">
            <div className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The QR to /r/<slug> in the bottom bar; tapping it opens a big one to scan from the room. */
function QrCard({ url, name }: { url: string; name: string }) {
  const t = useT();
  return (
    <Dialog>
      <DialogTrigger className="flex items-center gap-2 rounded-lg text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" data-testid="stage-qr-card">
        <span className="size-12 shrink-0 rounded-md bg-white p-0.5 wide:stage:size-[clamp(3rem,7vh,5rem)]">{url && <Qr text={url} label={t("stage.qr", { url })} />}</span>
        <span className="text-xs leading-tight text-muted-foreground wide:text-[clamp(0.75rem,0.3rem+0.35vw,1rem)]">
          <b className="block font-semibold text-foreground">{t("duo.scan")}</b>
          {t("duo.qr.enlarge")}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[min(90vw,32rem)]" data-testid="stage-qr-big">
        <DialogTitle className="pr-8 text-lg font-semibold">{t("duo.qr.title", { name })}</DialogTitle>
        <div className="mx-auto aspect-square w-[min(80vw,70vh,28rem)] rounded-xl bg-white p-3">{url && <Qr text={url} label={t("stage.qr", { url })} />}</div>
        <p className="break-all text-center font-mono text-sm text-muted-foreground">{url.replace(/^https?:\/\//, "")}</p>
      </DialogContent>
    </Dialog>
  );
}

type VaultPhase = "none" | "funded" | "split" | "settled";

/**
 * The escrow as a vault: the key-shield dial, the amount in LED coins, and a pile of coins (lib/stage coinPlan) that
 * fills when the renter pays, colours at the AI split (teal back to the renter, pink damage to the owner, amber rent)
 * and drains into both lanes at settlement, one coin to the fee. The lanes either side carry the amount tags and what
 * each side paid or got (moneyBoard); the receipt under it prints one line per on-chain event.
 */
function Vault({ s, chainId, rows }: { s: StageStatus; chainId: number; rows: OwnerSide["rows"] }) {
  const t = useT();
  const l = s.lease;
  const m = moneyBoard(s);
  const baht = (u: bigint) => big(u, s);
  const thb = (u: bigint) => unitsToThb(u, s.price.thbPerUsdt);
  const phase: VaultPhase = m.phase === "funded" && l?.status === "MoveOut" ? "split" : m.phase;
  const claim = (s.events.findLast((e) => e.name === "Settled")?.args.landlordClaim as bigint | undefined) ?? BigInt(0);
  const total = m.paid ?? (phase === "none" ? m.renter : m.escrow);
  const split = phase === "split" && l ? { renter: l.proposal.tenantRefund, owner: l.proposal.landlordClaim } : phase === "settled" ? { renter: m.renter, owner: claim } : undefined;
  const plan = coinPlan(thb(total), split && { renter: thb(split.renter), owner: thb(split.owner) });
  const kind = (k: number) => (k < plan.renter ? "renter" : k < plan.renter + plan.owner ? "owner" : k === plan.count - 1 ? "fee" : "rent");
  const settled = phase === "settled";
  const escrowHref = l && explorerLink(chainId, "address", l.address);
  const rent = l?.terms.rentAmount ?? s.price.rent;
  const deposit = l?.terms.depositAmount ?? s.price.deposit;
  const stats: [string, string, string | undefined, "rent" | "renter" | "owner"][] = [
    ["duo-paid", t("stage.money.paid"), m.paid !== undefined ? baht(m.paid) : undefined, "rent"],
    ["duo-back", t("stage.money.back"), settled ? baht(m.renter) : undefined, "renter"],
    ["duo-got", t("stage.money.owner"), settled ? baht(m.owner) : undefined, "owner"],
    ["duo-fee", t("duo.vault.fee"), settled && m.fee !== undefined ? baht(m.fee) : undefined, "rent"],
  ];
  const stat = ([id, label, value, tone]: (typeof stats)[number]) => (
    <div key={id} className="duo-stat" data-testid={id} data-kind={tone} data-on={value ? "" : undefined}>
      <dt>{label}</dt>
      <dd>{value ?? "–"}</dd>
    </div>
  );
  // Re-keyed per transfer (not at the split, where no money moves), so the coins chase once more on each.
  const moved = `${s.rental?.lease}${m.phase}`;

  return (
    <div className="duo-centre duo-board" data-testid="duo-board" data-phase={phase}>
      <section className="duo-vault" data-phase={phase} aria-label={t("duo.vault.label")}>
        <div className="duo-dial" aria-hidden>
          <svg viewBox="0 0 90 90">
            <circle className="duo-dial-ticks" cx="45" cy="45" r="41" pathLength="96" />
            <circle className="duo-dial-needle" cx="45" cy="45" r="41" pathLength="96" />
          </svg>
          <LogoMark className="duo-dial-mark" />
        </div>
        <h2 className="duo-vault-title">
          {t("duo.board.escrow")}
          <small>{t("duo.board.escrowSub")}</small>
        </h2>
        <DotNum text={baht(m.escrow)} />
        <p className="duo-ledcap">
          <span>
            <span className="sr-only" data-testid="duo-escrow">
              {baht(m.escrow)}{" "}
            </span>
            {t("duo.board.held")}
          </span>
          {l &&
            (escrowHref ? (
              <a href={escrowHref} target="_blank" rel="noreferrer" className="duo-addr">
                {shortAddress(l.address)}
                <ExternalIcon />
              </a>
            ) : (
              <span className="duo-addr">{shortAddress(l.address)}</span>
            ))}
        </p>
        <div className="duo-pilewrap">
          <div className="duo-lane duo-lane-l">
            <Track key={`a${moved}`} dir={m.phase === "funded" ? "fwd" : settled ? "rev" : undefined} tag={m.phase === "funded" && m.paid !== undefined ? baht(m.paid) : settled ? baht(m.renter) : undefined} />
            <dl className="duo-stats">{stats.slice(0, 2).map(stat)}</dl>
          </div>
          <div className="duo-pile" data-testid="duo-pile" data-coin={plan.coin} data-count={plan.count} aria-hidden>
            {Array.from({ length: plan.count }, (_, k) => (
              <i key={k} className="duo-coin" data-kind={kind(k)} style={{ "--i": k } as CSSProperties} />
            ))}
          </div>
          <div className="duo-lane duo-lane-r">
            <Track key={`b${moved}`} dir={settled ? "fwd" : undefined} tag={settled ? baht(m.owner) : undefined} />
            <dl className="duo-stats">{stats.slice(2).map(stat)}</dl>
          </div>
        </div>
        <p className="duo-legend" data-testid="duo-legend">
          {split ? (
            <>
              <span>
                <i className="duo-dot" data-kind="renter" />
                {t("duo.vault.back", { amount: baht(split.renter) })}
              </span>
              {split.owner > BigInt(0) && (
                <span>
                  <i className="duo-dot" data-kind="owner" />
                  {t("duo.vault.damage", { amount: baht(split.owner) })}
                </span>
              )}
              <span>
                <i className="duo-dot" />
                {t("duo.vault.rent", { amount: baht(rent) })}
              </span>
            </>
          ) : (
            <>
              <span>
                <i className="duo-dot" />
                {t("duo.vault.coin", { amount: `฿${plan.coin.toLocaleString("en-US")}` })}
              </span>
              <span>{t("duo.vault.terms", { deposit: baht(deposit), rent: baht(rent) })}</span>
            </>
          )}
        </p>
        <p className="duo-lock" data-testid="duo-lock">
          <LockIcon />
          {t(`duo.vault.lock.${phase}`)}
        </p>
      </section>
      <Receipt s={s} chainId={chainId} rows={rows} />
    </div>
  );
}

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

/** What each on-chain event is, as the contract call that made it (a code word, the same in every language). */
const CALL: Record<string, string> = {
  LeaseCreated: "create",
  Funded: "fund",
  EvidenceAdded: "evidence",
  SettlementProposed: "propose",
  Settled: "accept",
  RentReleased: "payout",
  ProtocolFeePaid: "fee",
  DisputeRaised: "dispute",
  Cancelled: "cancel",
};

/** The on-chain receipt: one line per event of the rental, each with its BscScan link, and the payouts once settled. */
function Receipt({ s, chainId, rows }: { s: StageStatus; chainId: number; rows: OwnerSide["rows"] }) {
  const t = useT();
  const ref = useNewestInView(rows.length);
  const m = moneyBoard(s);
  const baht = (u: bigint) => big(u, s);
  return (
    <div ref={ref} className="duo-receipt" data-testid="stage-timeline-box">
      <div className="duo-paper">
        <p className="duo-rh">
          <b>{t("duo.vault.receipt")}</b>
          <span>{explorerLink(chainId, "tx", "0x") ? `BscScan · ${chainId === 97 ? "BSC testnet 97" : `BSC ${chainId}`}` : t("duo.vault.local", { id: chainId })}</span>
        </p>
        <ol data-testid="stage-timeline">
          {rows.map((e) => {
            const href = explorerLink(chainId, "tx", e.txHash);
            const hash = `${e.txHash.slice(0, 10)}…`;
            return (
              <li key={`${e.txHash}:${e.logIndex}`}>
                <span className="duo-call">{CALL[e.name] ?? e.name}</span>
                <span className="duo-what">{eventLabel(e, t)}</span>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="duo-hash">
                    {hash}
                    <ExternalIcon />
                  </a>
                ) : (
                  <span className="duo-hash">{hash}</span>
                )}
              </li>
            );
          })}
          {m.phase === "settled" && (
            <li className="duo-pay" data-testid="duo-payout">
              <span>→ {t("duo.vault.pay.renter", { amount: baht(m.renter) })}</span>
              <span>→ {t("duo.vault.pay.owner", { amount: baht(m.owner) })}</span>
              <span>→ {t("duo.vault.pay.fee", { amount: baht(m.fee ?? BigInt(0)) })}</span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}

/** The shop owner's phone: what the owner sees of this rental at each step, and the Accept (the presenter's, behind its code). */
function OwnerScreen({ o, listing, chainId }: { o: OwnerSide; listing: Listing; chainId: number }) {
  const t = useT();
  const { s, l } = o;
  const m = s && moneyBoard(s);
  const baht = (u: bigint) => big(u, s);
  const [pickup, dropoff] = [o.photos(0), o.photos(1)];
  const wallet = s && explorerLink(chainId, "address", s.owner);
  const open = l && l.status !== "Cancelled" && !s?.creating;
  return (
    <div className="flex size-full flex-col gap-4 bg-muted/40 px-4 pt-12 pb-6 text-foreground" data-testid="duo-owner-screen">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--duo-pink-soft)] text-[var(--duo-pink-fg)]">
          <ShopIcon />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <LogoMark className="size-4" />
            KeyScrow
            <span className="rounded bg-[var(--duo-pink-soft)] px-1.5 text-[var(--duo-pink-fg)]">{t("duo.shop.badge")}</span>
          </p>
          <p className="truncate text-lg font-semibold leading-tight">{listing.location}</p>
          <p className="truncate text-sm text-muted-foreground">{listing.name}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm">
        <p className="text-xl font-semibold leading-snug" data-testid="stage-headline">
          {s ? headline(s, t) : t("stage.loading")}
        </p>
        {!open ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- small static listing photo */}
            <img src={listing.photos[0]} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
            <p className="text-sm text-muted-foreground">{t("stage.terms", { rent: formatFiat(listing.rentThb, "THB"), deposit: formatFiat(listing.depositThb, "THB") })}</p>
          </>
        ) : (
          <>
            {(pickup.length > 0 || dropoff.length > 0) && (
              <div className="grid grid-cols-2 gap-2" data-testid="stage-photos">
                <Shots title={t("stage.photos.pickup")} hashes={pickup} />
                <Shots title={t("stage.photos.return")} hashes={dropoff} />
              </div>
            )}
            {l.status === "MoveOut" ? (
              <>
                <Row label={t("stage.money.back")} value={baht(l.proposal.tenantRefund)} />
                <Row label={t("duo.shop.toYou")} value={baht(l.proposal.landlordClaim)} />
                <Row label={t("duo.shop.rent")} value={baht(l.terms.rentAmount)} />
              </>
            ) : l.status === "Settled" && m?.phase === "settled" ? (
              <>
                <Row label={t("stage.money.owner")} value={baht(m.owner)} strong />
                <Row label={t("stage.money.back")} value={baht(m.renter)} />
                <Row label={t("duo.vault.fee")} value={baht(m.fee ?? BigInt(0))} />
              </>
            ) : (
              <>
                <Row label={t("duo.shop.deposit")} value={baht(l.terms.depositAmount)} strong={l.status !== "Created"} />
                <Row label={t("duo.shop.rent")} value={baht(l.terms.rentAmount)} />
              </>
            )}
            {o.canAccept && (
              <ActionButton className="[&_button]:min-h-12 [&_button]:w-full [&_button]:text-base" busy={o.busy === "accept"} onClick={() => o.presenter("accept")} data-testid="stage-accept">
                {t("stage.presenter.accept")}
              </ActionButton>
            )}
          </>
        )}
      </div>

      {s && (
        <div className="mt-auto flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm">
          <span className="min-w-0">
            <b className="block font-semibold">{t("duo.shop.wallet")}</b>
            {wallet ? (
              <a href={wallet} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted-foreground underline">
                {shortAddress(s.owner)}
              </a>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{shortAddress(s.owner)}</span>
            )}
          </span>
          <b className="text-lg tabular-nums">{m?.phase === "settled" ? baht(m.owner) : "฿0"}</b>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </p>
  );
}

function Shots({ title, hashes }: { title: string; hashes: string[] }) {
  const t = useT();
  if (!hashes.length) return <span />;
  return (
    <figure className="min-w-0">
      <div className="flex gap-1">
        {hashes.map((h) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={h} src={evidenceUrl(h)} alt={t("stage.photos.alt", { title })} className="aspect-[4/3] min-w-0 flex-1 rounded-lg bg-muted object-cover" />
        ))}
      </div>
      <figcaption className="mt-1 text-xs font-medium text-muted-foreground">{title}</figcaption>
    </figure>
  );
}
