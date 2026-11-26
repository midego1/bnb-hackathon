"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatEther, type Address, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { LogoMark } from "@/components/LogoMark";
import { ActionButton, Notice } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { friendlyError } from "@/lib/errors";
import { errorsIn } from "@/lib/errors.zh";
import { uploadEvidence } from "@/lib/evidence";
import { useT } from "@/lib/i18n/client";
import { shortAddress } from "@/lib/format";
import { decodeJson } from "@/lib/chainIndex";
import { getListing, LISTINGS, photoSrcSet, type Listing } from "@/lib/listings";
import { answeredBy, runInspection, type InspectionResult } from "@/lib/settlement";
import { judgeStep, MAINNET_STAGE_CHAIN_ID, mirroredRenter, moneyBoard, same, stageTerms, takenByOther, thbText, thbUsdText, type JudgeStep, type StageStatus } from "@/lib/stage";
import { stageAction, useStageStatus } from "./client";
import { anchorPhotos, fundLease, proposeSplit } from "./judgeTx";
import { Glyph, ICON, IosCard, IosSteps, IosTxs, KV, SplitBar, SuccessCheck, TxRow, type Tone } from "./JudgeIos";
import { chooseExternal, createGuestKey, forgetGuestKey, guestWallet, loadExternal, loadGuestKey, stagePublicClient, subscribeGuestKey, subscribeNothing } from "./wallet";

/**
 * The judge's phone (/r/<slug>): choose what to rent (the shared catalogue, this slug preselected) -> guest wallet -> test money (on BSC mainnet: real money, max 1 USD) -> rent (owner offers, judge funds) -> pickup photos ->
 * return photos -> AI inspection -> propose the split -> the presenter accepts on the big screen -> money back.
 * Every step is read back from the chain (via /api/stage), so reloading the phone continues where it was.
 * `duo`: the phone pane of /duo, which shows a judge renting on their own phone read-only (lib/stage mirroredRenter),
 * and tells /duo which item the phone has chosen (postMessage), so the owner pane follows it. There it is drawn as the
 * KeyScrow iPhone app (JudgeIos: the 7-dot step row, the app's cards, the on-chain transactions); the same flow.
 * The chooser is skipped while this phone's own rental of the item is under way, on BSC mainnet (only the stage item
 * has the 1 USD price there) and after a pick (?chosen=1 in the URL, so a reload carries on).
 */
export function JudgeFlow({ listing: first, chainId, duo = false }: { listing: Listing; chainId: number; duo?: boolean }) {
  const [slug, setSlug] = useState(first.slug);
  const [choosing, setChoosing] = useState(() => !new URLSearchParams(window.location.search).has("chosen"));
  const listing = getListing(slug) ?? first;
  const guestKey = useSyncExternalStore(subscribeGuestKey, loadGuestKey, () => undefined);
  const external = useSyncExternalStore(subscribeGuestKey, loadExternal, () => false);
  const ready = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const wagmi = useAccount();
  // A wallet the browser connected on its own is not used unless the judge picked "Connect MetaMask".
  const me: Address | undefined = guestKey ? privateKeyToAccount(guestKey).address : external ? wagmi.address : undefined;
  const { status, offline, error: pollError, refresh } = useStageStatus(listing.slug, me);
  const { data: wagmiWallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const pub = useMemo(() => stagePublicClient(chainId), [chainId]);

  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const t = useT();

  async function signer(): Promise<WalletClient> {
    if (guestKey) return guestWallet(guestKey, chainId);
    if (!wagmiWallet) throw new Error(t("judge.connectFirst"));
    if (wagmiWallet.chain?.id !== chainId) await switchChainAsync({ chainId: chainId as never });
    return wagmiWallet;
  }

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setNote(undefined);
      setError(friendlyError(e, errorsIn(t.lang)));
    } finally {
      setBusy(undefined);
    }
  }

  const mirror = duo && status ? mirroredRenter(status, me) : undefined;
  const step: JudgeStep | undefined = ready && status ? judgeStep(status, mirror ?? me) : undefined;
  const thb = (units: bigint) => thbText(units, status?.price.thbPerUsdt ?? 33);
  const mainnet = chainId === MAINNET_STAGE_CHAIN_ID;
  const free = !mainnet && !mirror && !!step && !UNDER_WAY.has(step); // nothing of this phone's own is under way
  const choose = choosing && free;
  const canChange = free && !choosing;
  const loaded = !!step;

  useEffect(() => {
    if (duo && loaded) window.parent.postMessage({ duoSlug: slug, choosing: choose }, window.location.origin);
  }, [duo, loaded, slug, choose]);

  /** Pick `to` (or go back to the chooser): the URL follows, so a reload or the QR's short link lands right. */
  function pick(to: string, open: boolean) {
    setSlug(to);
    setChoosing(open);
    setError(undefined);
    setNote(undefined);
    const q = [duo && "duo=1", !open && "chosen=1"].filter(Boolean).join("&");
    window.history.replaceState(null, "", `/r/${to}${q ? `?${q}` : ""}`);
  }

  return (
    <main
      className={
        duo
          ? "ios mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-background px-5 pt-14 pb-6"
          : "mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      }
      data-testid="judge-flow"
      data-step={choose ? "choose" : (step ?? "loading")}
      data-mirror={mirror ? "true" : undefined}
    >
      {duo && (
        <nav className="ios-nav -mx-1">
          {canChange ? (
            <button type="button" className="ios-back" aria-label={t("judge.choose.change")} onClick={() => pick(slug, true)}>
              <Glyph d="M15 5l-7 7 7 7" w={2.4} />
            </button>
          ) : (
            <span />
          )}
          <p>{choose ? "KeyScrow" : t("judge.ios.nav")}</p>
        </nav>
      )}
      {duo ? (
        <IosHeader listing={listing} chainId={chainId} choose={choose} canChange={canChange} mainnet={mainnet} onChange={() => pick(slug, true)} />
      ) : (
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static photo or a local photo preview (blob URL) */}
          {!choose && <img src={listing.photos[0]} alt="" className="h-14 w-14 rounded-xl object-cover" />}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><LogoMark className="size-6 shrink-0" />KeyScrow</p>
            <h1 className="truncate text-xl font-semibold">{choose ? t.h("judge.choose") : listing.name}</h1>
            {!choose && <p className="text-sm text-muted-foreground">{t("stage.terms", stageTerms(listing, chainId))}</p>}
            {canChange && (
              <button type="button" className="text-sm text-info underline" onClick={() => pick(slug, true)} data-testid="judge-change">
                {t("judge.choose.change")}
              </button>
            )}
            {mainnet && (
              <p className="text-sm font-semibold text-warning-fg" data-testid="judge-real-money">
                {t("stage.realMoney")}
              </p>
            )}
          </div>
        </header>
      )}
      {duo && step && !choose && <IosSteps step={step} />}

      {offline && <Notice kind="warn">{t("judge.offline")}</Notice>}
      {!status && !offline && <p className="text-muted-foreground">{t("stage.loading")}</p>}
      {!status && pollError && offline && <Notice kind="error">{pollError}</Notice>}

      {mirror && (
        <div data-testid="judge-mirror">
          <Notice>{t("judge.mirror", { address: shortAddress(mirror) })}</Notice>
        </div>
      )}
      {choose && <Chooser current={slug} me={me} chainId={chainId} ios={duo} onPick={(to) => pick(to, false)} />}
      {status && step && !choose && (
        // Read-only mirror: its buttons and camera are disabled, its text stays readable (also to screen readers).
        <fieldset disabled={!!mirror} className="contents">
          <Step
            step={step}
            status={status}
            me={mirror ?? me}
            busy={busy}
            thb={thb}
            chainId={chainId}
            guest={!!guestKey}
            onGuest={createGuestKey}
            act={act}
            signer={signer}
            pub={pub}
            setNote={setNote}
            ios={duo}
          />
        </fieldset>
      )}

      {note && <Notice>{note}</Notice>}
      {error && (
        <div data-testid="judge-error">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {duo && status && !choose && status.rental && same(status.rental.renter, mirror ?? me) && <IosTxs status={status} chainId={chainId} />}

      {me && (
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-subtle">
          <span>
            {guestKey ? t(mainnet ? "judge.guestWalletMainnet" : "judge.guestWallet") : t("judge.yourWallet")} · <span className="font-mono">{shortAddress(me)}</span>
          </span>
          {(guestKey || external) && (step === "wallet" || step === "money" || step === "settled" || step === "busy") && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                forgetGuestKey();
                chooseExternal(false);
              }}
            >
              {t("judge.another")}
            </button>
          )}
        </footer>
      )}
    </main>
  );
}

/** Steps of this phone's own rental once it is paid for: the chooser stays away until it settles. */
const UNDER_WAY = new Set<JudgeStep>(["fund", "pickup", "return", "inspect", "waiting"]);

/** The app's header: a large title on the chooser; else the item's photo, name and terms (and "Change scooter"). */
function IosHeader(p: { listing: Listing; chainId: number; choose: boolean; canChange: boolean; mainnet: boolean; onChange: () => void }) {
  const t = useT();
  if (p.choose) {
    return (
      <header className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight font-bold">{t.h("judge.choose")}</h1>
        <p className="ios-body">{t("judge.ios.readyBody")}</p>
      </header>
    );
  }
  return (
    <header className="flex items-center gap-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static photo */}
      <img src={p.listing.photos[0]} alt="" className="size-16 shrink-0 rounded-2xl border border-border object-cover" />
      <div className="min-w-0">
        <h1 className="ios-headline truncate">{p.listing.name}</h1>
        <p className="text-[15px] text-muted-foreground tabular-nums">{t("stage.terms", stageTerms(p.listing, p.chainId))}</p>
        {p.canChange && (
          <button type="button" className="text-[13px] font-semibold text-info" onClick={p.onChange} data-testid="judge-change">
            {t("judge.choose.change")}
          </button>
        )}
        {p.mainnet && (
          <p className="text-sm font-semibold text-warning-fg" data-testid="judge-real-money">
            {t("stage.realMoney")}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * Step 0: the shared catalogue as compact cards, `current` highlighted. An item someone else holds right now is shown
 * but cannot be picked; each item's stage is read once when the chooser opens (the next steps re-check it live).
 */
function Chooser({ current, me, chainId, ios, onPick }: { current: string; me?: Address; chainId: number; ios: boolean; onPick: (slug: string) => void }) {
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const t = useT();
  useEffect(() => {
    let alive = true;
    for (const l of LISTINGS) {
      fetch(`/api/stage/${l.slug}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : undefined))
        .then((text) => text && alive && setTaken((x) => ({ ...x, [l.slug]: takenByOther(decodeJson<StageStatus>(text), me) })))
        .catch(() => {}); // unknown stays pickable: the rent step says "busy" if it is not
    }
    return () => {
      alive = false;
    };
  }, [me]);
  if (ios) {
    // The app's catalogue as an inset grouped list: photo, name, place, terms, the escrow line; a tick on the pick.
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("judge.ios.ready")}</h2>
        <ul className="ios-list" data-testid="judge-choose">
          {LISTINGS.map((l) => (
            <li key={l.slug}>
              <button
                type="button"
                disabled={taken[l.slug]}
                aria-current={l.slug === current || undefined}
                onClick={() => onPick(l.slug)}
                data-testid={`judge-pick-${l.slug}`}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small static catalogue photo */}
                <img src={l.photos[0]} srcSet={photoSrcSet(l.photos[0], "jpg")} sizes="4.5rem" alt="" className="size-[68px] shrink-0 rounded-xl object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold">{l.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{l.location}</span>
                  <span className="block truncate text-[13px] tabular-nums">{t("stage.terms", stageTerms(l, chainId))}</span>
                  {taken[l.slug] ? (
                    <span className="block text-[13px] font-semibold text-warning-fg">{t("judge.choose.rented")}</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[12px] font-semibold text-success">
                      <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden>
                        <path d={ICON.shield} />
                      </svg>
                      {t("judge.ios.protected")}
                    </span>
                  )}
                </span>
                {l.slug === current ? (
                  <span className="ios-check">
                    <Glyph d="M6 12.5l4 4 8-9" w={3} />
                  </span>
                ) : (
                  <span className="text-subtle">
                    <Glyph d="M9 5l7 7-7 7" />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="judge-choose">
      {LISTINGS.map((l) => (
        <li key={l.slug}>
          <button
            type="button"
            disabled={taken[l.slug]}
            aria-current={l.slug === current || undefined}
            onClick={() => onPick(l.slug)}
            data-testid={`judge-pick-${l.slug}`}
            className={`flex w-full items-center gap-3 rounded-2xl border bg-surface p-2 text-left shadow-sm disabled:opacity-60 ${
              l.slug === current ? "border-primary ring-2 ring-primary" : "border-border hover:border-border-strong"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- small static catalogue photo */}
            <img src={l.photos[0]} srcSet={photoSrcSet(l.photos[0], "jpg")} sizes="5rem" alt="" className="h-16 w-20 shrink-0 rounded-xl object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{l.name}</span>
              <span className="block truncate text-sm text-muted-foreground">{l.location}</span>
              <span className="block text-sm">{t("stage.terms", stageTerms(l, chainId))}</span>
              {taken[l.slug] && <span className="block text-sm font-semibold text-warning-fg">{t("judge.choose.rented")}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type StepProps = {
  step: JudgeStep;
  status: StageStatus;
  me?: Address;
  busy?: string;
  thb: (u: bigint) => string;
  chainId: number;
  guest: boolean;
  onGuest: () => void;
  act: (label: string, fn: () => Promise<void>) => Promise<void>;
  signer: () => Promise<WalletClient>;
  pub: ReturnType<typeof stagePublicClient>;
  setNote: (n?: string) => void;
  /** Drawn as the iPhone app (the phone inside /duo). */
  ios: boolean;
};

/** A step's card; in the iPhone app look, the app's card with its icon tile. */
function Big({ title, children, ios, icon = "lock", tone }: { title: ReactNode; children?: ReactNode; ios?: boolean; icon?: keyof typeof ICON; tone?: Tone }) {
  if (ios)
    return (
      <IosCard icon={icon} tone={tone} title={title}>
        {children}
      </IosCard>
    );
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-2xl font-semibold leading-tight">{title}</h2>
      {children}
    </section>
  );
}

const bigButton = "[&>button]:min-h-14 [&>button]:w-full [&>button]:text-lg";

function Step(p: StepProps) {
  const { status, me, busy, thb, ios } = p;
  const lease = status.lease;
  const t = useT();
  const tx = (h: string) => explorerLink(p.chainId, "tx", h);

  switch (p.step) {
    case "wallet":
      return <WalletStep onGuest={p.onGuest} mainnet={p.chainId === MAINNET_STAGE_CHAIN_ID} ios={ios} />;

    case "money": {
      const m = p.chainId === MAINNET_STAGE_CHAIN_ID ? "Mainnet" : "";
      return (
        <Big title={t.h(`judge.money${m}`)} ios={ios} icon="drop" tone="info">
          <p className="text-muted-foreground">{t(`judge.money.body${m}`, { amount: (m ? thbUsdText : thbText)(status.price.rent + status.price.deposit, status.price.thbPerUsdt) })}</p>
          <ActionButton
            className={bigButton}
            busy={busy === "drip"}
            data-testid="judge-drip"
            onClick={() =>
              p.act("drip", async () => {
                const r = await stageAction<{ txs: string[]; sent: { bnb: bigint; token: bigint } }>(status.listing.slug, { action: "drip", address: me });
                // What went out this time (a repeat only tops up the shortfall), baht first.
                const what = [
                  r.sent.token > BigInt(0) && thbUsdText(r.sent.token, status.price.thbPerUsdt),
                  r.sent.bnb > BigInt(0) && t("judge.money.gas", { amount: Number(formatEther(r.sent.bnb)).toFixed(4), symbol: m ? "BNB" : "tBNB" }),
                ].filter(Boolean).join(" + ");
                p.setNote(r.txs.length ? t(`judge.money.sent${m}.${r.txs.length > 1 ? "other" : "one"}`, { n: r.txs.length, what }) : t("judge.money.nothing"));
              })
            }
          >
            {ios && <Glyph d={ICON.drop} />}
            {t(`judge.money.button${m}`)}
          </ActionButton>
        </Big>
      );
    }

    case "rent":
    case "fund": {
      const rent = lease && p.step === "fund" ? lease.terms.rentAmount : status.price.rent;
      const deposit = lease && p.step === "fund" ? lease.terms.depositAmount : status.price.deposit;
      return (
        <Big title={t.h("judge.rent", { amount: thb(status.price.rent) })} ios={ios} icon="lock">
          {ios ? (
            <dl className="flex flex-col gap-2.5">
              <KV label={t("judge.rent.rent")} thb={thb(rent)} units={rent} />
              <KV label={t("judge.rent.deposit")} thb={thb(deposit)} units={deposit} />
              <hr className="ios-rule" />
              <KV label={t("judge.ios.total")} thb={thb(rent + deposit)} units={rent + deposit} strong />
            </dl>
          ) : (
            <dl className="grid grid-cols-2 gap-y-1 text-lg">
              <dt className="text-muted-foreground">{t("judge.rent.rent")}</dt>
              <dd className="text-right font-semibold tabular-nums">{thb(rent)}</dd>
              <dt className="text-muted-foreground">{t("judge.rent.deposit")}</dt>
              <dd className="text-right font-semibold tabular-nums">{thb(deposit)}</dd>
            </dl>
          )}
          <p className="text-sm text-muted-foreground">{t("judge.rent.body")}</p>
          <ActionButton
            className={bigButton}
            busy={busy === "rent"}
            data-testid="judge-rent"
            onClick={() =>
              p.act("rent", async () => {
                p.setNote(t("judge.rent.preparing"));
                const { lease: address } = await stageAction<{ lease: Address }>(status.listing.slug, { action: "lease", address: me });
                p.setNote(t("judge.rent.paying"));
                await fundLease(await p.signer(), p.pub, address);
                p.setNote(undefined);
              })
            }
          >
            {ios && <Glyph d={ICON.lock} />}
            {t("judge.rent.button")}
          </ActionButton>
        </Big>
      );
    }

    case "busy":
      return (
        <Big title={t.h("judge.busy")} ios={ios} icon="people" tone="warning">
          <p className="text-muted-foreground">{t("judge.busy")}</p>
        </Big>
      );

    case "pickup":
    case "return":
      return <PhotoStep {...p} kind={p.step} />;

    case "inspect":
      return <InspectStep {...p} />;

    case "waiting":
      return (
        <Big title={t.h("judge.waiting")} ios={ios} icon="hourglass" tone="warning">
          {ios && (
            <dl className="flex flex-col gap-2.5">
              <KV label={t("judge.inspect.back")} thb={thb(lease!.proposal.tenantRefund)} units={lease!.proposal.tenantRefund} strong />
              <KV label={t("judge.inspect.owner")} thb={thb(lease!.proposal.landlordClaim)} units={lease!.proposal.landlordClaim} />
            </dl>
          )}
          <p className="text-muted-foreground">{t("judge.waiting.body", { back: thb(lease!.proposal.tenantRefund), kept: thb(lease!.proposal.landlordClaim) })}</p>
          <p className="animate-pulse text-sm text-subtle">{t("judge.waiting.watching")}</p>
        </Big>
      );

    case "settled": {
      const settled = status.events.findLast((e) => e.name === "Settled");
      // Until the chain index has the Settled event (a poll later), the accepted proposal says the same amount.
      const back = settled ? (settled.args.tenantRefund as bigint) + (settled.args.rentToTenant as bigint) : (lease?.proposal.tenantRefund ?? BigInt(0));
      const href = settled && tx(settled.txHash);
      if (ios) {
        const m = moneyBoard(status);
        return (
          <section className="ios-card gap-4">
            <SuccessCheck />
            <h2 className="ios-display" data-testid="judge-settled">
              {t.h("judge.settled", { amount: thb(back) })}
            </h2>
            <p className="text-center">{t("judge.settled.body", { name: status.listing.name })}</p>
            {m.phase === "settled" && (
              <>
                <hr className="ios-rule" />
                <SplitBar
                  parts={[
                    { id: "back", label: t("judge.inspect.back"), value: m.renter, text: thb(m.renter) },
                    { id: "owner", label: t("judge.inspect.owner"), value: m.owner, text: thb(m.owner) },
                    { id: "fee", label: t("judge.ios.fee"), value: m.fee ?? BigInt(0), text: thb(m.fee ?? BigInt(0)) },
                  ]}
                />
              </>
            )}
            {settled && (
              <>
                <hr className="ios-rule" />
                <TxRow label={t("judge.settled.bscscan")} hash={settled.txHash} chainId={p.chainId} />
              </>
            )}
            {same(status.rental?.renter, me) && <p className="text-center text-xs text-subtle">{t("judge.settled.escrow", { address: shortAddress(lease?.address) })}</p>}
          </section>
        );
      }
      return (
        <Big title={<span data-testid="judge-settled">{t.h("judge.settled", { amount: thb(back) })}</span>}>
          <p className="text-muted-foreground">{t("judge.settled.body", { name: status.listing.name })}</p>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="text-lg font-medium underline">
              {t("judge.settled.bscscan")}
            </a>
          )}
          {same(status.rental?.renter, me) && <p className="text-xs text-subtle">{t("judge.settled.escrow", { address: shortAddress(lease?.address) })}</p>}
        </Big>
      );
    }
  }
}

function WalletStep({ onGuest, mainnet, ios }: { onGuest: () => void; mainnet: boolean; ios: boolean }) {
  const { openConnectModal } = useConnectModal();
  const t = useT();
  // WalletConnect needs a project id; without one only a browser wallet (MetaMask's in-app browser) can connect.
  const hasWallet = useSyncExternalStore(
    subscribeNothing,
    () => !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || !!(window as { ethereum?: unknown }).ethereum,
    () => false,
  );
  return (
    <Big title={t.h("judge.wallet")} ios={ios} icon="key">
      <ActionButton className={bigButton} onClick={onGuest} data-testid="judge-guest">
        {ios && <Glyph d={ICON.key} />}
        {t("judge.wallet.guest")}
      </ActionButton>
      <p className="-mt-2 text-sm text-muted-foreground">{t(mainnet ? "judge.wallet.guestHintMainnet" : "judge.wallet.guestHint")}</p>
      {hasWallet && (
        <ActionButton
          variant="secondary"
          className={bigButton}
          onClick={() => {
            chooseExternal(true);
            openConnectModal?.(); // undefined when a wallet is already connected: then that one is used
          }}
        >
          {t("judge.wallet.metamask")}
        </ActionButton>
      )}
    </Big>
  );
}

function PhotoStep(p: StepProps & { kind: "pickup" | "return" }) {
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [reading, setReading] = useState(false);
  const lease = p.status.lease!;
  const t = useT();

  async function add(f: File | undefined) {
    if (!f) return;
    setReading(true);
    try {
      const { compressPhoto } = await import("./photo"); // camera code loads on first use only
      const file = await compressPhoto(f);
      setPhotos((ps) => [...ps, { file, url: URL.createObjectURL(file) }].slice(-3));
    } catch (e) {
      p.setNote(friendlyError(e, errorsIn(t.lang)));
    } finally {
      setReading(false);
    }
  }

  const anchored = p.status.events.filter((e) => e.name === "EvidenceAdded").map((e) => String(e.args.contentHash).toLowerCase());
  return (
    <Big title={t.h(p.kind === "pickup" ? "judge.pickup" : "judge.return")} ios={p.ios} icon={p.kind === "pickup" ? "camera" : "back"}>
      <p className="text-muted-foreground">{t(p.kind === "pickup" ? "judge.photos.pickupBody" : "judge.photos.returnBody", { name: p.status.listing.name })}</p>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((ph) => (
          // eslint-disable-next-line @next/next/no-img-element -- small static photo or a local photo preview (blob URL)
          <img key={ph.url} src={ph.url} alt={t(`judge.photos.alt.${p.kind}`)} className="aspect-square w-full rounded-lg object-cover" />
        ))}
      </div>
      <label
        className={`inline-flex min-h-14 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-surface text-lg font-medium ${p.ios ? "ios-secondary" : ""} ${reading || p.busy ? "pointer-events-none opacity-45" : ""}`}
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          data-testid={`judge-camera-${p.kind}`}
          onChange={(e) => {
            add(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {p.ios && <Glyph d={ICON.camera} />}
        {t(reading ? "judge.photos.reading" : photos.length ? "judge.photos.another" : "judge.photos.open")}
      </label>
      <ActionButton
        className={bigButton}
        busy={p.busy === "photos"}
        disabledReason={photos.length === 0 ? t("judge.photos.atLeastOne") : undefined}
        data-testid={`judge-save-${p.kind}`}
        onClick={() =>
          p.act("photos", async () => {
            const { items, warning } = await uploadEvidence(photos.map((x) => x.file));
            if (warning && items.some((i) => i.storage === "browser")) p.setNote(t("judge.photos.uploadFailed"));
            await anchorPhotos(await p.signer(), p.pub, lease.address, p.kind, items.map((i) => i.hash), anchored);
            setPhotos([]);
          })
        }
      >
        {p.ios && <Glyph d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />}
        {t(`judge.photos.save.${p.kind}.${photos.length === 0 ? "zero" : photos.length === 1 ? "one" : "other"}`, { n: photos.length })}
      </ActionButton>
    </Big>
  );
}

function InspectStep(p: StepProps) {
  const [result, setResult] = useState<InspectionResult>();
  const lease = p.status.lease!;
  const t = useT();
  const ev = (kind: number) =>
    p.status.events.filter((e) => e.name === "EvidenceAdded" && Number(e.args.kind) === kind).map((e) => String(e.args.contentHash).toLowerCase() as Hex);

  return (
    <Big title={t.h("judge.inspect")} ios={p.ios} icon="sparkles">
      {!result ? (
        <>
          <p className="text-muted-foreground">{t("judge.inspect.body")}</p>
          <ActionButton
            className={bigButton}
            busy={p.busy === "inspect"}
            disabledReason={!ev(0).length || !ev(1).length ? t("judge.inspect.waitingPhotos") : undefined}
            data-testid="judge-inspect"
            onClick={() =>
              p.act("inspect", async () => {
                setResult(
                  await runInspection({
                    deposit: lease.terms.depositAmount,
                    checkIn: ev(0),
                    checkOut: ev(1),
                    scooterId: p.status.listing.slug,
                    notes: p.status.listing.stage ? `The item is "${p.status.listing.name}", a physical item rented for a day (not a scooter).` : `The scooter is a ${p.status.listing.name}.`,
                  }),
                );
              })
            }
          >
            {p.ios && <Glyph d={ICON.sparkles} />}
            {t("judge.inspect.run")}
          </ActionButton>
        </>
      ) : (
        <>
          {p.ios && (
            <SplitBar
              parts={[
                { id: "back", label: t("judge.inspect.back"), value: BigInt(result.tenantRefund), text: p.thb(BigInt(result.tenantRefund)) },
                { id: "owner", label: t("judge.inspect.owner"), value: BigInt(result.landlordClaim), text: p.thb(BigInt(result.landlordClaim)) },
              ]}
            />
          )}
          <dl className="grid grid-cols-2 gap-y-1 text-lg" data-testid="judge-split">
            <dt className="text-muted-foreground">{t("judge.inspect.back")}</dt>
            <dd className="text-right font-semibold tabular-nums">{p.thb(BigInt(result.tenantRefund))}</dd>
            <dt className="text-muted-foreground">{t("judge.inspect.owner")}</dt>
            <dd className="text-right font-semibold tabular-nums">{p.thb(BigInt(result.landlordClaim))}</dd>
          </dl>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-xs text-subtle" data-testid="judge-answered-by">
            {result.mock && !result.fallback ? t("judge.inspect.mock") : answeredBy(result, t)}
          </p>
          <ActionButton
            className={bigButton}
            busy={p.busy === "propose"}
            data-testid="judge-propose"
            onClick={() => p.act("propose", async () => proposeSplit(await p.signer(), p.pub, lease.address, BigInt(result.tenantRefund), result.reportHash))}
          >
            {p.ios && <Glyph d="M4 12l16-8-6 16-2.5-6.5L4 12Z" />}
            {t("judge.inspect.propose")}
          </ActionButton>
        </>
      )}
    </Big>
  );
}
