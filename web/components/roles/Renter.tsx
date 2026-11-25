"use client";

import { ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { EvidenceThumb } from "@/components/lease/EvidencePanel";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, Amount, Notice, StatusBadge } from "@/components/ui";
import { LeaseStatus } from "@/lib/contracts";
import { photosForHash } from "@/lib/demoEvidence";
import { postFleet, scooterState, type Scooter } from "@/lib/fleet";
import { shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useRentals } from "@/lib/hooks/useRentals";
import type { RentalSummary } from "@/lib/rentals";
import { usePrices } from "@/lib/usePrices";
import { FlagBadge, useFleet } from "./shared";
import { ScooterStateBadge, thbToUsdt } from "./FleetOwner";

/** Renter: browse and book scooters, then follow each rental (photos, AI inspection, deposit outcome). */
export function Renter() {
  const { address } = useAccount();
  const { chainId } = useDeployment();
  const { data: fleet } = useFleet();
  const { data: index, error: indexError, refetch, isFetching } = useRentals();
  const rentalMap = useMemo(() => new Map((index?.rentals ?? []).map((r) => [r.address.toLowerCase(), r])), [index]);
  const me = address?.toLowerCase();
  const myBookings = (fleet?.bookings ?? []).filter((b) => b.renter.toLowerCase() === me && b.status !== "declined");
  const myRentals = (index?.rentals ?? []).filter((r) => r.tenant.toLowerCase() === me);
  const scooterOf = new Map<string, Scooter>();
  for (const s of fleet?.scooters ?? []) for (const r of s.rentals) scooterOf.set(r.toLowerCase(), s);
  // Bookable scooters first.
  const scooters = (fleet?.scooters ?? [])
    .map((s) => ({ s, ...scooterState(s, rentalMap, fleet?.bookings) }))
    .sort((a, b) => Number(b.state === "available") - Number(a.state === "available"));

  return (
    <div className="space-y-8">
      <ChainReadNotice error={indexError} hasData={!!index} stale={index?.stale} block={index?.latestBlock} onRetry={() => refetch()} retrying={isFetching} what="your rentals" />
      <section>
        <h2 className="mb-3 text-lg font-semibold">Find a scooter</h2>
        {scooters.length === 0 ? (
          <p className="text-sm text-subtle">No scooters listed on this network yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="scooter-catalog">
            {scooters.map(({ s, state }) => (
              <BookCard key={s.id} s={s} state={state} chainId={chainId} mine={myBookings.find((b) => b.scooterId === s.id && b.status === "requested")?.id} />
            ))}
          </ul>
        )}
      </section>

      {myBookings.filter((b) => b.status === "requested").length > 0 && (
        <Notice>
          Booking sent. The shop now issues the rental contract for your wallet {address && <span className="font-mono">{shortAddress(address)}</span>}; it shows up
          under &ldquo;My rentals&rdquo; to pay deposit + rent.
        </Notice>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">My rentals</h2>
        {myRentals.length === 0 ? (
          <p className="text-sm text-subtle">No rentals for this wallet yet. Book a scooter above.</p>
        ) : (
          <ul className="space-y-3" data-testid="renter-rentals">
            {myRentals.map((r) => (
              <RentalStory key={r.address} r={r} scooter={scooterOf.get(r.address.toLowerCase())} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BookCard({ s, state, chainId, mine }: { s: Scooter; state: ReturnType<typeof scooterState>["state"]; chainId: number; mine?: string }) {
  const { address } = useAccount();
  const { prices } = usePrices();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = prices?.rates.USDT.THB;
  const total = thbToUsdt(s.rentThb, rate) + thbToUsdt(s.depositThb, rate);

  async function book() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await postFleet(chainId, { action: "book", scooterId: s.id, renter: address });
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border" data-testid="book-card" data-scooter={s.id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled demo photo or content-addressed evidence */}
      <img src={s.photo} alt={s.name} className="aspect-[2/1] w-full bg-muted object-cover" loading="lazy" />
      <div className="space-y-2 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{s.name}</p>
            <p className="text-xs text-subtle">{s.location}</p>
          </div>
          <ScooterStateBadge state={state} />
        </div>
        <p>
          <span className="font-semibold">฿{s.rentThb.toLocaleString("en-US")}</span>
          <span className="text-subtle"> / month · ฿{s.depositThb.toLocaleString("en-US")} deposit in escrow, no passport</span>
        </p>
        <p className="text-xs text-subtle">
          Pay up front: <Amount value={total} className="inline-flex" />
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <ActionButton
          className="w-full"
          busy={busy}
          data-testid="book-scooter"
          disabledReason={!address ? "Connect a wallet to book." : mine ? "Requested. Waiting for the shop." : state !== "available" ? "Not available right now." : null}
          onClick={book}
        >
          Book this scooter
        </ActionButton>
      </div>
    </li>
  );
}

/** One rental from the renter's side: what to do next, photos, AI inspection, and where the deposit went. */
function RentalStory({ r, scooter }: { r: RentalSummary; scooter?: Scooter }) {
  const pickup = r.pickupPhotos.flatMap(photosForHash);
  const ret = r.returnPhotos.flatMap(photosForHash);
  const next =
    r.status === LeaseStatus.Created
      ? "Pay deposit + first month into the escrow"
      : r.status === LeaseStatus.Active
        ? r.returnPhotos.length
          ? "Run the AI return inspection and propose the split"
          : "Ride safe. At return, take the guided return photos"
        : r.status === LeaseStatus.MoveOut
          ? "Return proposal open"
          : r.status === LeaseStatus.Disputed
            ? "The dispute desk is reviewing the photos"
            : undefined;
  return (
    <li className="rounded-2xl border border-border p-4" data-testid="renter-rental" data-address={r.address} data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{scooter ? `${scooter.name} · ${scooter.location}` : `Rental ${shortAddress(r.address)}`}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {r.flags.map((f) => <FlagBadge key={f.code} flag={f} />)}
          </div>
        </div>
        <Link href={`/lease/${r.address}`} className="text-sm font-medium underline-offset-2 hover:underline" data-testid="open-rental">
          {r.status === LeaseStatus.Created ? "Pay now" : "Open rental"} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />
        </Link>
      </div>
      {next && <p className="mt-2 text-sm text-muted-foreground">{next}</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-muted p-3 text-sm">
          <p className="text-xs text-subtle">Deposit</p>
          <Amount value={r.depositAmount} />
          {r.settled ? (
            <p className="mt-1 text-xs" data-testid="deposit-outcome">
              {r.settled.landlordClaim > BigInt(0) ? (
                <>
                  <span className="text-success-fg">Returned</span> <Amount value={r.settled.tenantRefund} className="inline-flex" /> ·{" "}
                  <span className="text-danger">slashed</span> <Amount value={r.settled.landlordClaim} className="inline-flex" /> for damage
                </>
              ) : (
                <span className="text-success-fg">Fully returned</span>
              )}
            </p>
          ) : r.totals.depositLocked > BigInt(0) ? (
            <p className="mt-1 text-xs text-subtle">Locked in escrow. The shop can never take it alone.</p>
          ) : null}
        </div>
        <div className="rounded-xl bg-muted p-3 text-sm sm:col-span-2">
          <p className="text-xs text-subtle">AI inspection</p>
          {r.proposal ? (
            <p data-testid="inspection-outcome">
              Back to you <Amount value={r.proposal.tenantRefund} className="inline-flex" /> · for damage <Amount value={r.proposal.landlordClaim} className="inline-flex" />
              <span className="block text-xs text-subtle">
                proposed by the {r.proposal.proposer.toLowerCase() === r.tenant.toLowerCase() ? "renter" : "owner"} · report{" "}
                <span className="font-mono">{r.proposal.reportHash.slice(0, 10)}…</span>
              </span>
            </p>
          ) : (
            <p className="text-subtle">Runs at return: it compares pickup and return photos.</p>
          )}
        </div>
      </div>

      {(pickup.length > 0 || ret.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PhotoStrip title="Pickup photos" photos={pickup} />
          <PhotoStrip title="Return photos" photos={ret} />
        </div>
      )}
    </li>
  );
}

function PhotoStrip({ title, photos }: { title: string; photos: ReturnType<typeof photosForHash> }) {
  return (
    <div>
      <p className="mb-1 text-xs text-subtle">{title}</p>
      {photos.length === 0 ? (
        <p className="text-xs text-subtle">None yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {photos.slice(0, 6).map((p) => (
            <EvidenceThumb key={p.hash} photo={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

