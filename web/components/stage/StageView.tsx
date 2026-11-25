"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { zeroHash } from "viem";
import { ActionButton, Notice } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { evidenceUrl } from "@/lib/evidence";
import { formatFiat } from "@/lib/fiat";
import { shortAddress } from "@/lib/format";
import type { Listing } from "@/lib/listings";
import { eventLabel, same, thbText, type StageStatus } from "@/lib/stage";
import { stageAction, useStageStatus } from "./client";
import { subscribeNothing } from "./wallet";

// The QR encoder loads after the page, not with it.
const Qr = dynamic(() => import("./Qr"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-white/80" /> });

const CODE_KEY = "keyescrow.stage.presenterCode";
const big = (u: bigint, s?: StageStatus) => thbText(u, s?.price.thbPerUsdt ?? 33);

/** What is happening now, in one line for the back of the room. */
function headline(s: StageStatus): string {
  const l = s.lease;
  if (s.creating) return "The owner is creating the rental…";
  if (!l || l.status === "Cancelled") return `Scan to rent the ${s.listing.name}`;
  switch (l.status) {
    case "Created":
      return "Rental offered: waiting for the renter to pay";
    case "Active":
      if (l.checkInHash === zeroHash) return `${big(l.terms.depositAmount + l.terms.rentAmount, s)} locked in escrow: pickup photos next`;
      if (l.checkOutHash === zeroHash) return "Picked up: waiting for the return";
      return "Returned: the AI inspector is comparing photos";
    case "MoveOut":
      return `AI split proposed: ${big(l.proposal.tenantRefund, s)} back, ${big(l.proposal.landlordClaim, s)} to the owner`;
    case "Disputed":
      return "In dispute: the dispute desk decides";
    case "Settled":
      return "Settled: both sides agreed, the money is paid out";
  }
}

/** The big-screen presenter view (/stage/<slug>): QR to the phone flow, the rental live, and the owner's buttons. */
export function StageView({ listing, chainId }: { listing: Listing; chainId: number }) {
  const { status: s, offline, refresh } = useStageStatus(listing.slug);
  const url = useSyncExternalStore(subscribeNothing, () => `${window.location.origin}/r/${listing.slug}`, () => "");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  async function presenter(action: "accept" | "reset") {
    if (action === "reset" && !window.confirm("Reset the stage? The current rental stays on-chain, but the next scan starts a fresh one.")) return;
    let code: string | undefined;
    try {
      code = localStorage.getItem(CODE_KEY) ?? undefined;
    } catch {}
    if (s?.presenterLocked && !code) {
      code = window.prompt("Presenter code") ?? undefined;
      try {
        if (code) localStorage.setItem(CODE_KEY, code);
      } catch {}
    }
    setBusy(action);
    setError(undefined);
    try {
      await stageAction(listing.slug, { action, code });
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
  const paid = funded ? (funded.args.deposit as bigint) + (funded.args.firstRent as bigint) : undefined;
  const fee = sa?.fee;
  const toOwner = sa ? sa.landlordClaim + sa.rentToLandlord - sa.fee : undefined;
  const back = sa ? sa.tenantRefund + sa.rentToTenant : undefined;
  const photos = (kind: number) => (s?.events ?? []).filter((e) => e.name === "EvidenceAdded" && Number(e.args.kind) === kind).map((e) => String(e.args.contentHash));
  const canAccept = l?.status === "MoveOut" && same(l.proposal.proposer, s?.rental?.renter);
  const link = (kind: "tx" | "address", v: string) => explorerLink(chainId, kind, v);

  return (
    <main className="grid min-h-dvh gap-6 p-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:p-10" data-testid="stage-view" data-status={l?.status ?? "none"}>
      <section className="flex flex-col items-center gap-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static listing photo */}
        <img src={listing.photos[0]} alt={listing.name} className="aspect-[4/3] w-full max-w-sm rounded-2xl object-cover" />
        <h1 className="text-4xl font-bold tracking-tight lg:text-5xl">{listing.name}</h1>
        <p className="text-2xl text-muted-foreground">
          {formatFiat(listing.rentThb, "THB")} / day · {formatFiat(listing.depositThb, "THB")} deposit
        </p>
        <div className="aspect-square w-full max-w-[20rem] rounded-2xl bg-white p-3">{url && <Qr text={url} label={`QR code: ${url}`} />}</div>
        <p className="break-all font-mono text-2xl" data-testid="stage-url">
          {url.replace(/^https?:\/\//, "")}
        </p>
      </section>

      <section className="flex min-w-0 flex-col gap-6">
        {offline && <Notice kind="warn">Reconnecting… the rental is safe on-chain; this screen catches up when the network is back.</Notice>}
        <h2 className="text-4xl font-semibold leading-tight lg:text-5xl" data-testid="stage-headline">
          {s ? headline(s) : "Loading…"}
        </h2>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stage-money">
          <Money label="Renter paid" value={paid !== undefined ? big(paid, s) : "–"} sub={s?.rental && shortAddress(s.rental.renter)} href={s?.rental && link("address", s.rental.renter)} />
          <Money label="In escrow" value={l ? big(l.balance, s) : "–"} sub={l && shortAddress(l.address)} href={l && link("address", l.address)} strong />
          <Money label="Owner got" value={toOwner !== undefined ? big(toOwner, s) : "–"} sub={s && shortAddress(s.owner)} href={s && link("address", s.owner)} />
          <Money label="Back to renter" value={back !== undefined ? big(back, s) : "–"} sub={fee !== undefined ? `fee ${big(fee, s)}` : undefined} />
        </div>

        {(photos(0).length > 0 || photos(1).length > 0) && (
          <div className="flex flex-wrap gap-6">
            <Photos title="Pickup" hashes={photos(0)} />
            <Photos title="Return" hashes={photos(1)} />
          </div>
        )}

        <ol className="flex flex-col gap-2 text-xl" data-testid="stage-timeline">
          {(s?.events ?? [])
            .filter((e) => e.name !== "PayeeSet")
            .slice(-8)
            .map((e) => {
              const href = link("tx", e.txHash);
              return (
                <li key={`${e.txHash}:${e.logIndex}`} className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
                  <span>{eventLabel(e)}</span>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-base text-info underline">
                      BscScan {e.txHash.slice(0, 8)}…
                    </a>
                  ) : (
                    <span className="shrink-0 font-mono text-base text-subtle">{e.txHash.slice(0, 10)}…</span>
                  )}
                </li>
              );
            })}
        </ol>

        <div className="mt-auto flex flex-wrap items-start gap-3 [&_button]:min-h-14 [&_button]:px-6 [&_button]:text-lg">
          <ActionButton busy={busy === "accept"} disabledReason={!canAccept ? "Accept appears once the renter proposes a split." : undefined} onClick={() => presenter("accept")} data-testid="stage-accept">
            Accept the split (owner)
          </ActionButton>
          <ActionButton variant="secondary" busy={busy === "reset"} onClick={() => presenter("reset")} data-testid="stage-reset">
            Reset stage
          </ActionButton>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </section>
    </main>
  );
}

function Money({ label, value, sub, href, strong }: { label: string; value: string; sub?: ReactNode; href?: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? "border-info-border bg-info-soft" : "border-border bg-surface"}`}>
      <div className="text-lg text-muted-foreground">{label}</div>
      <div className="text-4xl font-bold tabular-nums">{value}</div>
      {sub && (href ? <a href={href} target="_blank" rel="noreferrer" className="font-mono text-sm text-subtle underline">{sub}</a> : <div className="font-mono text-sm text-subtle">{sub}</div>)}
    </div>
  );
}

function Photos({ title, hashes }: { title: string; hashes: string[] }) {
  if (!hashes.length) return null;
  return (
    <figure>
      <figcaption className="mb-1 text-lg text-muted-foreground">{title}</figcaption>
      <div className="flex gap-2">
        {hashes.map((h) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={h} src={evidenceUrl(h)} alt={`${title} photo`} className="h-28 w-28 rounded-lg bg-muted object-cover" />
        ))}
      </div>
    </figure>
  );
}
