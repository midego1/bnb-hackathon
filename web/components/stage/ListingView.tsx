"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { ActionButton, Card, Notice, PageTitle } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { formatFiat } from "@/lib/fiat";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { LISTING_PHOTOS, photoSrcSet, type Listing } from "@/lib/listings";
import { targetChainId } from "@/lib/chains";
import { judgeStep, same, stageTerms, type StageStatus } from "@/lib/stage";
import { stageAction, useStageStatus } from "./client";

const never = () => () => {};
/**
 * False on the server and while React hydrates, true right after. The wallet is only known in the browser, and this
 * page hydrates late (it streams in a Suspense boundary, after wagmi has reconnected), so the first render must not
 * look at the wallet or it would not match the server's HTML.
 */
const useMounted = () => useSyncExternalStore(never, () => true, () => false);

const SIZES = "(min-width: 768px) 30rem, 92vw";
const LINK = "inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-medium";
const PRIMARY = `${LINK} bg-primary text-primary-foreground hover:bg-primary-hover`;
const SECONDARY = `${LINK} border border-border-strong`;

/**
 * Something anyone can rent (/app/listings/<slug>). The Mystery Box of the live judge demo is rented from a phone
 * (/r/<slug>); a demo scooter is rented right here with the wallet connected in the app (RentIt below).
 */
export function ListingView({ listing, enabled }: { listing: Listing; enabled: boolean }) {
  const { address } = useAccount();
  const mounted = useMounted();
  const me = mounted ? address : undefined;
  const scooter = !listing.stage;
  // The stage item's page reads its owner once. A scooter's page reads its rental and this wallet's balances when it
  // opens, when the wallet changes and after each button; in between once a minute is plenty (a browsing page can stay
  // open all day, and every read is a Worker request plus chain reads).
  const { status, error, refresh } = useStageStatus(listing.slug, scooter ? me : undefined, scooter && enabled ? 60_000 : 3_600_000);
  const t = useT();
  const terms = stageTerms(listing, targetChainId);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={listing.name}>{listing.description}</PageTitle>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {listing.photos.map((src) => {
            const p = LISTING_PHOTOS[src];
            return (
              <figure key={src} data-testid="listing-photo">
                <picture>
                  <source type="image/avif" srcSet={photoSrcSet(src, "avif")} sizes={SIZES} />
                  <source type="image/webp" srcSet={photoSrcSet(src, "webp")} sizes={SIZES} />
                  <img src={src} srcSet={photoSrcSet(src, "jpg")} sizes={SIZES} alt={p.alt} width={p.width} height={p.height} className="h-auto w-full rounded-2xl border border-border object-cover" />
                </picture>
                <figcaption className="mt-2 text-xs text-subtle">
                  {t("listing.photoBy", { author: p.credit.author, license: p.credit.license })}{" "}
                  <Link href="/credits" prefetch={false} className="underline">
                    {t("listing.credits")}
                  </Link>
                </figcaption>
              </figure>
            );
          })}
        </div>
        <Card title={t.h(scooter ? "listing.rentScooter" : "listing.rentTitle")}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm" data-testid="listing-terms">
            <dt className="text-muted-foreground">{t("listing.rent")}</dt>
            <dd className="text-right font-semibold">{t("listing.perDay", { amount: terms.rent })}</dd>
            {listing.monthThb !== undefined && (
              <>
                <dt className="text-muted-foreground">{t("listing.month")}</dt>
                <dd className="text-right font-semibold">{t("listing.perMonth", { amount: formatFiat(listing.monthThb, "THB") })}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("listing.deposit")}</dt>
            <dd className="text-right font-semibold">{terms.deposit}</dd>

            <dt className="text-muted-foreground">{t("listing.where")}</dt>
            <dd className="text-right">{listing.location}</dd>
            <dt className="text-muted-foreground">{t("listing.owner")}</dt>
            <dd className="text-right font-mono">{status ? shortAddress(status.owner) : t("listing.demoOwner")}</dd>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">{t("listing.body")}</p>
          {scooter && (
            <p className="mt-3 text-sm font-medium" data-testid="listing-demo">
              {t("listing.demo")}
            </p>
          )}
          {!enabled ? (
            <p className="mt-4 text-sm text-subtle">{t("listing.off")}</p>
          ) : scooter ? (
            <RentIt listing={listing} mounted={mounted} me={me} status={status} loadError={error} refresh={refresh} />
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={`/r/${listing.slug}?chosen=1`} className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover" data-testid="listing-rent">
                {t("listing.rentThis")}
              </a>
              <a href={`/stage/${listing.slug}`} className="inline-flex min-h-10 items-center rounded-lg border border-border-strong px-4 py-2 text-sm font-medium">
                {t("listing.stage")}
              </a>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

/**
 * A scooter's call to action, one step at a time: connect a wallet, get test money if it is short, then "Rent it": the
 * demo owner offers this wallet the rental (a real createLease, signed on the server by lib/server/stage) and the
 * rental page takes over (approve, fund, photos, return). Which step is next comes from chain state (lib/stage
 * judgeStep), so a reload or a second tab carries on where it was.
 */
function RentIt(p: { listing: Listing; mounted: boolean; me?: Address; status?: StageStatus; loadError?: string; refresh: () => Promise<void> }) {
  const { listing, me, status, loadError, refresh } = p;
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"drip" | "lease">();
  const [failed, setFailed] = useState<string>();

  async function run(action: "drip" | "lease") {
    setBusy(action);
    setFailed(undefined);
    try {
      const out = await stageAction<{ lease?: Address }>(listing.slug, { action, address: me });
      if (out.lease) return router.push(`/lease/${out.lease}`); // stays busy until the rental page is up
      await refresh();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      await refresh(); // the refusal may mean the picture changed (someone else just rented it)
    }
    setBusy(undefined);
  }

  // A status read for another wallet (or none) says nothing about this one: wait for the next poll.
  const mine = status && same(status.me?.address, me) ? status : undefined;
  const step = mine && judgeStep(mine, me);
  const lease = mine?.rental?.lease;
  const big = "[&>button]:min-h-11";
  const loading = (
    <p className="text-sm text-subtle" role="status">
      {t("listing.loading")}
    </p>
  );
  return (
    <div className="mt-4 flex min-h-36 flex-col gap-3" data-testid="listing-flow" data-step={step ?? "loading"}>
      <p className="text-sm text-muted-foreground">{t("listing.how")}</p>
      {!p.mounted ? (
        loading
      ) : (
        <WalletGate what={t("listing.gate")}>
          {!step ? (
            loadError && !status ? (
              <Notice kind="error">{loadError}</Notice>
            ) : (
              loading
            )
          ) : step === "busy" ? (
            <Notice>{t("listing.taken")}</Notice>
          ) : lease && step !== "settled" && step !== "money" && step !== "rent" ? (
            <div>
              <Link href={`/lease/${lease}`} className={PRIMARY} data-testid="listing-continue">
                {t(step === "fund" ? "listing.fund" : "listing.continue")}
              </Link>
            </div>
          ) : (
            <>
              {/* The drip is once per wallet, so it is only ever an extra: "Rent it" is always there. */}
              {step === "money" && !mine.drip && (
                <ActionButton className={big} busy={busy === "drip"} disabled={!!busy} onClick={() => run("drip")} data-testid="listing-money">
                  {t("listing.getMoney")}
                </ActionButton>
              )}
              {step === "money" && <p className="text-xs text-subtle">{t(mine.drip ? "listing.topUp" : "listing.getMoneyHint")}</p>}
              <div className="flex flex-wrap items-start gap-3">
                <ActionButton className={big} variant={step === "money" && !mine.drip ? "secondary" : "primary"} busy={busy === "lease"} disabled={!!busy} onClick={() => run("lease")} data-testid="listing-rent-it">
                  {t(busy === "lease" ? "listing.rentItBusy" : "listing.rentIt")}
                </ActionButton>
                {step === "settled" && lease && (
                  <Link href={`/lease/${lease}`} className={SECONDARY}>
                    {t("listing.last")}
                  </Link>
                )}
              </div>
            </>
          )}
        </WalletGate>
      )}
      {failed && <Notice kind="error">{failed}</Notice>}
    </div>
  );
}
