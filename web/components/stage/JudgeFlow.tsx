"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { type Address, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { ActionButton, Notice } from "@/components/ui";
import { explorerLink } from "@/lib/chains";
import { friendlyError } from "@/lib/errors";
import { uploadEvidence } from "@/lib/evidence";
import { formatFiat } from "@/lib/fiat";
import { shortAddress } from "@/lib/format";
import type { Listing } from "@/lib/listings";
import { runInspection, type InspectionResult } from "@/lib/settlement";
import { judgeStep, same, thbText, type JudgeStep, type StageStatus } from "@/lib/stage";
import { stageAction, useStageStatus } from "./client";
import { anchorPhotos, fundLease, proposeSplit } from "./judgeTx";
import { chooseExternal, createGuestKey, forgetGuestKey, guestWallet, loadExternal, loadGuestKey, stagePublicClient, subscribeGuestKey, subscribeNothing } from "./wallet";

/**
 * The judge's phone (/r/<slug>): guest wallet -> test money -> rent (owner offers, judge funds) -> pickup photos ->
 * return photos -> AI inspection -> propose the split -> the presenter accepts on the big screen -> money back.
 * Every step is read back from the chain (via /api/stage), so reloading the phone continues where it was.
 */
export function JudgeFlow({ listing, chainId }: { listing: Listing; chainId: number }) {
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

  async function signer(): Promise<WalletClient> {
    if (guestKey) return guestWallet(guestKey, chainId);
    if (!wagmiWallet) throw new Error("Connect your wallet first.");
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
      setError(friendlyError(e));
    } finally {
      setBusy(undefined);
    }
  }

  const step: JudgeStep | undefined = ready && status ? judgeStep(status, me) : undefined;
  const thb = (units: bigint) => thbText(units, status?.price.thbPerUsdt ?? 33);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-5" data-testid="judge-flow" data-step={step ?? "loading"}>
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static photo or a local photo preview (blob URL) */}
        <img src={listing.photos[0]} alt="" className="h-14 w-14 rounded-xl object-cover" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{listing.name}</h1>
          <p className="text-sm text-muted">
            {formatFiat(listing.rentThb, "THB")} / day · {formatFiat(listing.depositThb, "THB")} deposit
          </p>
        </div>
      </header>

      {offline && <Notice kind="warn">Connection is shaky. Your rental is safe on-chain; this screen catches up when the network is back.</Notice>}
      {!status && !offline && <p className="text-muted">Loading…</p>}
      {!status && pollError && offline && <Notice kind="error">{pollError}</Notice>}

      {status && step && (
        <Step
          step={step}
          status={status}
          me={me}
          busy={busy}
          thb={thb}
          chainId={chainId}
          guest={!!guestKey}
          onGuest={createGuestKey}
          act={act}
          signer={signer}
          pub={pub}
          setNote={setNote}
        />
      )}

      {note && <Notice>{note}</Notice>}
      {error && (
        <div data-testid="judge-error">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      {me && (
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-subtle">
          <span>
            {guestKey ? "Testnet guest wallet, no real money" : "Your wallet"} · <span className="font-mono">{shortAddress(me)}</span>
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
              Use another wallet
            </button>
          )}
        </footer>
      )}
    </main>
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
};

function Big({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-2xl font-semibold leading-tight">{title}</h2>
      {children}
    </section>
  );
}

const bigButton = "[&>button]:min-h-14 [&>button]:w-full [&>button]:text-lg";

function Step(p: StepProps) {
  const { status, me, busy, thb } = p;
  const lease = status.lease;
  const tx = (h: string) => explorerLink(p.chainId, "tx", h);

  switch (p.step) {
    case "wallet":
      return <WalletStep onGuest={p.onGuest} />;

    case "money":
      return (
        <Big title="Get test money">
          <p className="text-muted">
            We send this wallet a little test BNB for gas and {thb(status.price.rent + status.price.deposit)} in test dollars (mUSDT) for the rent and the
            deposit. Testnet only, no real money.
          </p>
          <ActionButton
            className={bigButton}
            busy={busy === "drip"}
            data-testid="judge-drip"
            onClick={() =>
              p.act("drip", async () => {
                const r = await stageAction<{ txs: string[] }>(status.listing.slug, { action: "drip", address: me });
                p.setNote(r.txs.length ? `Test money sent (${r.txs.length} transaction${r.txs.length > 1 ? "s" : ""}).` : undefined);
              })
            }
          >
            Get test money
          </ActionButton>
        </Big>
      );

    case "rent":
    case "fund":
      return (
        <Big title={`Rent it for ${thb(status.price.rent)}`}>
          <dl className="grid grid-cols-2 gap-y-1 text-lg">
            <dt className="text-muted">Rent (1 day)</dt>
            <dd className="text-right font-semibold tabular-nums">{thb(lease && p.step === "fund" ? lease.terms.rentAmount : status.price.rent)}</dd>
            <dt className="text-muted">Deposit (comes back)</dt>
            <dd className="text-right font-semibold tabular-nums">{thb(lease && p.step === "fund" ? lease.terms.depositAmount : status.price.deposit)}</dd>
          </dl>
          <p className="text-sm text-muted">The money goes into this rental&apos;s own escrow contract on BNB Chain, not to the owner. Nobody can take the deposit alone.</p>
          <ActionButton
            className={bigButton}
            busy={busy === "rent"}
            data-testid="judge-rent"
            onClick={() =>
              p.act("rent", async () => {
                p.setNote("The owner is preparing your rental…");
                const { lease: address } = await stageAction<{ lease: Address }>(status.listing.slug, { action: "lease", address: me });
                p.setNote("Paying into the escrow…");
                await fundLease(await p.signer(), p.pub, address);
                p.setNote(undefined);
              })
            }
          >
            Pay into escrow
          </ActionButton>
        </Big>
      );

    case "busy":
      return (
        <Big title="Someone else is renting it right now">
          <p className="text-muted">Only one rental at a time. Ask the presenter to reset the stage, then reload this page.</p>
        </Big>
      );

    case "pickup":
    case "return":
      return <PhotoStep {...p} kind={p.step} />;

    case "inspect":
      return <InspectStep {...p} />;

    case "waiting":
      return (
        <Big title="Waiting for the owner">
          <p className="text-muted">
            You proposed: {thb(lease!.proposal.tenantRefund)} back to you, {thb(lease!.proposal.landlordClaim)} to the owner. The owner accepts on the
            big screen.
          </p>
          <p className="animate-pulse text-sm text-subtle">Watching the chain…</p>
        </Big>
      );

    case "settled": {
      const settled = status.events.findLast((e) => e.name === "Settled");
      const back = settled ? (settled.args.tenantRefund as bigint) + (settled.args.rentToTenant as bigint) : BigInt(0);
      const href = settled && tx(settled.txHash);
      return (
        <Big title={<span data-testid="judge-settled">Your {thb(back)} are back</span>}>
          <p className="text-muted">The escrow paid out and closed. Thanks for renting the {status.listing.name}!</p>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="text-lg font-medium underline">
              See it on BscScan
            </a>
          )}
          {same(status.rental?.renter, me) && <p className="text-xs text-subtle">Escrow {shortAddress(lease?.address)}</p>}
        </Big>
      );
    }
  }
}

function WalletStep({ onGuest }: { onGuest: () => void }) {
  const { openConnectModal } = useConnectModal();
  // WalletConnect needs a project id; without one only a browser wallet (MetaMask's in-app browser) can connect.
  const hasWallet = useSyncExternalStore(
    subscribeNothing,
    () => !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || !!(window as { ethereum?: unknown }).ethereum,
    () => false,
  );
  return (
    <Big title="Rent it with one tap">
      <ActionButton className={bigButton} onClick={onGuest} data-testid="judge-guest">
        Use a guest wallet
      </ActionButton>
      <p className="-mt-2 text-sm text-muted">Testnet guest wallet, no real money. A fresh key is made on this phone and never leaves it.</p>
      {hasWallet && (
        <ActionButton
          variant="secondary"
          className={bigButton}
          onClick={() => {
            chooseExternal(true);
            openConnectModal?.(); // undefined when a wallet is already connected: then that one is used
          }}
        >
          Connect MetaMask
        </ActionButton>
      )}
    </Big>
  );
}

function PhotoStep(p: StepProps & { kind: "pickup" | "return" }) {
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [reading, setReading] = useState(false);
  const lease = p.status.lease!;
  const label = p.kind === "pickup" ? "pickup" : "return";

  async function add(f: File | undefined) {
    if (!f) return;
    setReading(true);
    try {
      const { compressPhoto } = await import("./photo"); // camera code loads on first use only
      const file = await compressPhoto(f);
      setPhotos((ps) => [...ps, { file, url: URL.createObjectURL(file) }].slice(-3));
    } catch (e) {
      p.setNote(friendlyError(e));
    } finally {
      setReading(false);
    }
  }

  const anchored = p.status.events.filter((e) => e.name === "EvidenceAdded").map((e) => String(e.args.contentHash).toLowerCase());
  return (
    <Big title={p.kind === "pickup" ? "Take pickup photos" : "Hand it back, then take return photos"}>
      <p className="text-muted">
        {p.kind === "pickup"
          ? "Photograph the box as you get it (1 to 3 photos). Their fingerprints go on-chain, so nobody can swap them later."
          : "Give the box back to the presenter and photograph it again (1 to 3 photos). The AI inspector compares them with the pickup photos."}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((ph) => (
          // eslint-disable-next-line @next/next/no-img-element -- small static photo or a local photo preview (blob URL)
          <img key={ph.url} src={ph.url} alt={`${label} photo`} className="aspect-square w-full rounded-lg object-cover" />
        ))}
      </div>
      <label
        className={`inline-flex min-h-14 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-surface text-lg font-medium ${reading || p.busy ? "pointer-events-none opacity-45" : ""}`}
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
        {reading ? "Reading photo…" : photos.length ? "Take another photo" : "Open the camera"}
      </label>
      <ActionButton
        className={bigButton}
        busy={p.busy === "photos"}
        disabledReason={photos.length === 0 ? "Take at least one photo." : undefined}
        data-testid={`judge-save-${p.kind}`}
        onClick={() =>
          p.act("photos", async () => {
            const { items, warning } = await uploadEvidence(photos.map((x) => x.file));
            if (warning && items.some((i) => i.storage === "browser")) p.setNote("Photo upload failed, so only their fingerprints go on-chain.");
            await anchorPhotos(await p.signer(), p.pub, lease.address, p.kind, items.map((i) => i.hash), anchored);
            setPhotos([]);
          })
        }
      >
        {`Save ${photos.length || ""} ${label} photo${photos.length === 1 ? "" : "s"} on-chain`}
      </ActionButton>
    </Big>
  );
}

function InspectStep(p: StepProps) {
  const [result, setResult] = useState<InspectionResult>();
  const lease = p.status.lease!;
  const ev = (kind: number) =>
    p.status.events.filter((e) => e.name === "EvidenceAdded" && Number(e.args.kind) === kind).map((e) => String(e.args.contentHash).toLowerCase() as Hex);

  return (
    <Big title="AI inspection">
      {!result ? (
        <>
          <p className="text-muted">The AI inspector compares the pickup and return photos and proposes how to split the deposit.</p>
          <ActionButton
            className={bigButton}
            busy={p.busy === "inspect"}
            disabledReason={!ev(0).length || !ev(1).length ? "Waiting for the photos to show up on-chain…" : undefined}
            data-testid="judge-inspect"
            onClick={() =>
              p.act("inspect", async () => {
                setResult(
                  await runInspection({
                    deposit: lease.terms.depositAmount,
                    checkIn: ev(0),
                    checkOut: ev(1),
                    scooterId: p.status.listing.slug,
                    notes: `The item is "${p.status.listing.name}", a physical item rented for a day (not a scooter).`,
                  }),
                );
              })
            }
          >
            Run the AI inspection
          </ActionButton>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-y-1 text-lg" data-testid="judge-split">
            <dt className="text-muted">Back to you</dt>
            <dd className="text-right font-semibold tabular-nums">{p.thb(BigInt(result.tenantRefund))}</dd>
            <dt className="text-muted">To the owner</dt>
            <dd className="text-right font-semibold tabular-nums">{p.thb(BigInt(result.landlordClaim))}</dd>
          </dl>
          <ul className="list-disc pl-5 text-sm text-muted">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {result.mock && <p className="text-xs text-subtle">Demo inspector (no vision model key on this server): deterministic, not a real look at the photos.</p>}
          <ActionButton
            className={bigButton}
            busy={p.busy === "propose"}
            data-testid="judge-propose"
            onClick={() => p.act("propose", async () => proposeSplit(await p.signer(), p.pub, lease.address, BigInt(result.tenantRefund), result.reportHash))}
          >
            Propose this split
          </ActionButton>
        </>
      )}
    </Big>
  );
}
