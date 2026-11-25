"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, Amount, Notice } from "@/components/ui";
import { postFleet, scooterState, type Scooter } from "@/lib/fleet";
import { shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useRentals } from "@/lib/hooks/useRentals";
import { useT } from "@/lib/i18n/client";
import { usePrices } from "@/lib/usePrices";
import { RentalCard } from "./RentalCard";
import { useFleet } from "./shared";
import { ScooterStateBadge, thbToUsdt } from "./FleetOwner";

/** Renter with a wallet: their rentals as big cards first, then the scooters they can book. */
export function Renter() {
  const t = useT();
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
    <div className="space-y-10">
      <ChainReadNotice error={indexError} hasData={!!index} stale={index?.stale} block={index?.latestBlock} onRetry={() => refetch()} retrying={isFetching} what={t("roles.what.rentals")} />
      <section>
        <h1 className="mb-4 text-3xl font-semibold tracking-tight">{t.h("renter.yours")}</h1>
        {myRentals.length === 0 ? (
          <p className="text-base text-muted-foreground">{t("renter.noneYet")}</p>
        ) : (
          <ul className="space-y-4" data-testid="renter-rentals">
            {myRentals.map((r) => (
              <RentalCard key={r.address} r={r} scooter={scooterOf.get(r.address.toLowerCase())} now={index!.chainNow} you />
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">{t.h("renter.find")}</h2>
          <Link href="/app/subscriptions" className="text-sm font-medium underline-offset-4 hover:underline" data-testid="tenant-subscriptions-link">
            {t("renter.subscribeLink")} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />
          </Link>
        </div>
        {scooters.length === 0 ? (
          <p className="text-sm text-subtle">{t("renter.noScooters")}</p>
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
          {t("renter.bookingSentBefore")}
          {address && <span className="font-mono">{shortAddress(address)}</span>}
          {t("renter.bookingSentAfter")}
        </Notice>
      )}

    </div>
  );
}

function BookCard({ s, state, chainId, mine }: { s: Scooter; state: ReturnType<typeof scooterState>["state"]; chainId: number; mine?: string }) {
  const t = useT();
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
          <span className="text-subtle">{t("renter.bookTerms", { deposit: s.depositThb.toLocaleString("en-US") })}</span>
        </p>
        <p className="text-xs text-subtle">
          {t("renter.payUpFront")}
          <Amount value={total} className="inline-flex" />
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <ActionButton
          className="w-full"
          busy={busy}
          data-testid="book-scooter"
          disabledReason={!address ? t("renter.connectToBook") : mine ? t("renter.requested") : state !== "available" ? t("renter.notAvailable") : null}
          onClick={book}
        >
          {t("renter.book")}
        </ActionButton>
      </div>
    </li>
  );
}
