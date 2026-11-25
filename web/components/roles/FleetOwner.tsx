"use client";

import { ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { parseEventLogs, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, Amount, Card, Field, inputClass, Notice, Skeleton, StatusBadge, useMoney } from "@/components/ui";
import { escrowFactoryAbi, TOKEN } from "@/lib/contracts";
import { countIn } from "@/lib/rentals";
import { planRent } from "@/lib/subscriptions";
import { incomeOf, postFleet, scooterState, type Booking, type Scooter, type ScooterState } from "@/lib/fleet";
import { shortAddress } from "@/lib/format";
import { hashText } from "@/lib/hash";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { useRentals } from "@/lib/hooks/useRentals";
import { useTx } from "@/lib/hooks/useTx";
import { LeaseStatus } from "@/lib/contracts";
import { usePrices } from "@/lib/usePrices";
import type { RentalSummary } from "@/lib/rentals";
import { FlagBadge, Kpi, useFleet } from "./shared";

/** Booked scooters are offered for one monthly rent period; the renter funds deposit + the month up front. */
export const BOOKING_TERM_PERIODS = 1;

export const stateStyle: Record<ScooterState, string> = {
  available: "bg-success-soft text-success-fg ring-success-border",
  booked: "bg-warning-soft text-warning-fg ring-warning-border",
  rented: "bg-info-soft text-info-fg ring-info-border",
  inspection: "bg-warning-soft text-warning-fg ring-warning-border",
  dispute: "bg-danger-soft text-danger-fg ring-danger-border",
};

export function ScooterStateBadge({ state }: { state: ScooterState }) {
  const t = useT();
  return (
    <span data-testid="scooter-state" data-state={state} className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${stateStyle[state]}`}>
      {t(`roles.state.${state}`)}
    </span>
  );
}

/**
 * THB -> USDT base units at today's rate (cents precision), as the escrow stores amounts in the stablecoin. Without a
 * rate yet, 33 THB/USDT stands in for display only: "Offer rental" waits for the real rate before anything goes on-chain.
 */
export function thbToUsdt(thb: number, thbPerUsdt: number | undefined) {
  const rate = thbPerUsdt && thbPerUsdt > 0 ? thbPerUsdt : 33;
  return parseUnits((thb / rate).toFixed(2), TOKEN.decimals);
}

/** Fleet owner dashboard: scooters with live status, income, booking requests, rentals and disputes. */
export function FleetOwner() {
  const t = useT();
  const { address } = useAccount();
  const { chainId, deployment } = useDeployment();
  const { data: index, error: indexError, refetch, isFetching } = useRentals();
  const { data: fleet } = useFleet();
  const money = useMoney();

  const rentalMap = useMemo(() => new Map((index?.rentals ?? []).map((r) => [r.address.toLowerCase(), r])), [index]);
  const me = address?.toLowerCase();
  const mine = (fleet?.scooters ?? []).filter((s) => s.owner.toLowerCase() === me);
  const myRentals = (index?.rentals ?? []).filter((r) => r.landlord.toLowerCase() === me);
  const direct = myRentals.filter((r) => r.payee.toLowerCase() === r.landlord.toLowerCase());
  const income = incomeOf(direct);
  const toVault = incomeOf(myRentals.filter((r) => !direct.includes(r)));
  const states = mine.map((s) => ({ s, ...scooterState(s, rentalMap, fleet?.bookings) }));
  const count = (st: ScooterState[]) => states.filter((x) => st.includes(x.state)).length;
  const active = myRentals.filter((r) => r.status === LeaseStatus.Active || r.status === LeaseStatus.MoveOut);
  const disputes = myRentals.filter((r) => r.status === LeaseStatus.Disputed);
  const requests = (fleet?.bookings ?? []).filter((b) => b.status === "requested" && mine.some((s) => s.id === b.scooterId));

  // Render the dashboard in one go once chain + catalogue data are in, so the page below does not jump around.
  if (!index || !fleet) {
    return (
      <div data-testid="fleet-owner" data-ready="false">
        {!index && indexError ? (
          <ChainReadNotice error={indexError} hasData={false} onRetry={() => refetch()} retrying={isFetching} what={t("roles.what.rentals")} />
        ) : (
          <Skeleton className="h-96" />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="fleet-owner" data-ready="true">
      <ChainReadNotice error={indexError} hasData stale={index.stale} block={index.latestBlock} onRetry={() => refetch()} retrying={isFetching} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label={t("fleet.kpi.scooters")} testId="kpi-scooters">{mine.length}</Kpi>
        <Kpi label={t("fleet.kpi.available")} testId="kpi-available">{count(["available"])}</Kpi>
        <Kpi label={t("fleet.kpi.rented")} testId="kpi-rented">{count(["rented", "booked"])}</Kpi>
        <Kpi label={t("fleet.kpi.inspection")} testId="kpi-inspection">{count(["inspection", "dispute"])}</Kpi>
        <Kpi label={t("fleet.kpi.active")} testId="kpi-active">{active.length}</Kpi>
        <Kpi label={t("fleet.kpi.disputes")} testId="kpi-disputes"><span className={disputes.length ? "text-danger" : ""}>{disputes.length}</span></Kpi>
        <Kpi label={t("fleet.kpi.income")} testId="kpi-income" hint={t("fleet.kpi.incomeHint", { amount: money(toVault.total) })}>
          <Amount value={income.total} />
        </Kpi>
      </div>

      {requests.length > 0 && (
        <Card title={t.h("fleet.requests", { n: requests.length })}>
          <ul className="divide-y divide-border" data-testid="booking-requests">
            {requests.map((b) => (
              <BookingRequest key={b.id} booking={b} scooter={mine.find((s) => s.id === b.scooterId)!} chainId={chainId} vault={deployment?.fleetVault} />
            ))}
          </ul>
        </Card>
      )}

      <Card title={t.h("fleet.myFleet")} aside={<span className="text-xs text-subtle">{t("fleet.fleetAside")}</span>}>
        {mine.length === 0 ? (
          <p className="text-sm text-subtle">{t("fleet.noScooters")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="fleet-list">
            {states.map(({ s, state, current }) => (
              <ScooterCard key={s.id} s={s} state={state} current={current} rentals={s.rentals.map((a) => rentalMap.get(a.toLowerCase())).filter((r): r is RentalSummary => !!r)} />
            ))}
          </ul>
        )}
      </Card>

      {(disputes.length > 0 || active.some((r) => r.flags.length > 0)) && (
        <Card title={t.h("fleet.attention")}>
          <ul className="space-y-2 text-sm" data-testid="owner-attention">
            {[...disputes, ...active.filter((r) => r.flags.length > 0)].map((r) => (
              <li key={r.address} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} />
                <Link href={`/lease/${r.address}`} className="font-mono underline-offset-2 hover:underline">{shortAddress(r.address)}</Link>
                {r.flags.map((f) => <FlagBadge key={f.code} flag={f} />)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddScooterForm owner={address} hasVault={!!deployment?.fleetVault} chainId={chainId} />
    </div>
  );
}

function ScooterCard({ s, state, current, rentals }: { s: Scooter; state: ScooterState; current?: RentalSummary; rentals: RentalSummary[] }) {
  const t = useT();
  const income = incomeOf(rentals);
  return (
    <li className="overflow-hidden rounded-xl border border-border" data-testid="scooter-card" data-scooter={s.id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled demo photo or content-addressed evidence */}
      <img src={s.photo} alt={s.name} className="aspect-[16/9] w-full bg-muted object-cover" loading="lazy" />
      <div className="space-y-2 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{s.name}</p>
            <p className="text-xs text-subtle">{s.location}</p>
          </div>
          <ScooterStateBadge state={state} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("fleet.terms", { rent: s.rentThb.toLocaleString("en-US"), deposit: s.depositThb.toLocaleString("en-US") })}
          {s.vault && <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-foreground">{t("fleet.toVault")}</span>}
        </p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-subtle">{t(rentals.length === 1 ? "fleet.rentalsOne" : "fleet.rentalsOther", { n: rentals.length })}</span>
          <Amount value={income.total} />
        </div>
        {current && (
          <Link href={`/lease/${current.address}`} className="block text-xs underline-offset-2 hover:underline">
            {t("fleet.current", { address: shortAddress(current.address) })} <ArrowRight aria-hidden className="inline size-3 align-[-1px]" />
          </Link>
        )}
      </div>
    </li>
  );
}

function BookingRequest({ booking, scooter, chainId, vault }: { booking: Booking; scooter: Scooter; chainId: number; vault?: Address }) {
  const t = useT();
  const { send, pending } = useTx();
  const { prices } = usePrices();
  const { deployment } = useDeployment();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toVault = scooter.vault && !!vault;
  const rate = prices?.rates.USDT.THB;
  // A subscription request carries the plan it was made under: its price, deposit and term.
  const sub = booking.subscription;
  const rentThb = sub?.priceThb ?? scooter.rentThb;
  const depositThb = sub?.depositThb ?? scooter.depositThb;
  // A plan's price is monthly; the escrow takes rent per period (monthly x days / 30).
  const rent = sub ? planRent(thbToUsdt(rentThb, rate), sub) : thbToUsdt(rentThb, rate);
  const deposit = thbToUsdt(depositThb, rate);

  async function offer() {
    setError(null);
    const params = {
      tenant: booking.renter,
      arbiter: zeroAddress,
      rentAmount: rent,
      depositAmount: deposit,
      termPeriods: sub?.maxPeriods ?? BOOKING_TERM_PERIODS,
      rentPeriod: sub ? sub.periodDays * 86_400 : 0, // 0 = factory default: monthly
      responseWindow: 0,
      arbiterWindow: 0,
      leaseHash: hashText(JSON.stringify({ scooter: scooter.id, name: scooter.name, renter: booking.renter, rentThb, depositThb, months: sub?.maxPeriods, thbPerUsdt: rate, booking: booking.id })),
    };
    const receipt = await send(t("fleet.offerTx"), {
      address: deployment!.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: toVault ? "createLeaseWithPayee" : "createLease",
      args: toVault ? [params, vault] : [params],
    });
    if (!receipt) return;
    const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: receipt.logs });
    if (!created) return setError(t("fleet.noAddress"));
    try {
      await postFleet(chainId, { action: "offer", bookingId: booking.id, lease: created.args.escrow as Address });
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" data-testid="booking-request">
      <div>
        <p className="font-medium">{scooter.name} · {scooter.location}</p>
        <p className="text-xs text-subtle">
          {t("fleet.renter")} <span className="font-mono">{shortAddress(booking.renter)}</span>
          {t("fleet.requestTerms", { rent: rentThb.toLocaleString("en-US"), deposit: depositThb.toLocaleString("en-US") })}
          {sub ? t("fleet.subscriptionTerm", { count: countIn(t, sub.maxPeriods, sub.periodDays * 86_400) }) : ""}
          {toVault ? t("fleet.paysVault") : ""}
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <div className="flex gap-2">
        <ActionButton
          variant="secondary"
          onClick={async () => {
            await postFleet(chainId, { action: "decline", bookingId: booking.id });
            await queryClient.invalidateQueries({ queryKey: ["fleet"] });
          }}
        >
          {t("fleet.decline")}
        </ActionButton>
        <ActionButton busy={pending === t("fleet.offerTx")} disabledReason={!rate && t("fleet.loadingRate")} onClick={offer} data-testid="offer-rental">
          {t("fleet.offer")}
        </ActionButton>
      </div>
    </li>
  );
}

function AddScooterForm({ owner, hasVault, chainId }: { owner?: Address; hasVault: boolean; chainId: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [rent, setRent] = useState("3500");
  const [deposit, setDeposit] = useState("7000");
  const [vault, setVault] = useState(hasVault);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!owner) return;
    setBusy(true);
    setMsg(null);
    try {
      await postFleet(chainId, { action: "addScooter", owner, name, location, rentThb: Number(rent), depositThb: Number(deposit), vault: vault && hasVault });
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
      setMsg({ kind: "info", text: t("fleet.listed", { name }) });
      setName("");
      setLocation("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.h("fleet.add")}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="add-scooter-form">
        <Field label={t("fleet.model")}>
          <input className={inputClass} name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Honda Click 160" required minLength={2} />
        </Field>
        <Field label={t("fleet.location")}>
          <input className={inputClass} name="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("fleet.locationPlaceholder")} required minLength={2} />
        </Field>
        <Field label={t("fleet.rent")}>
          <input className={inputClass} name="rentThb" inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value.replace(/\D/g, ""))} required />
        </Field>
        <Field label={t("fleet.deposit")} hint={t("fleet.depositHint")}>
          <input className={inputClass} name="depositThb" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ""))} required />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={vault && hasVault} disabled={!hasVault} onChange={(e) => setVault(e.target.checked)} name="vault" />
          {t("fleet.vault")}
          {!hasVault && t("fleet.noVault")}
        </label>
        <div className="sm:col-span-2 lg:col-span-2 flex justify-end">
          <ActionButton type="submit" busy={busy} disabledReason={!owner ? t("fleet.connectFirst") : null} data-testid="add-scooter">
            {t("fleet.list")}
          </ActionButton>
        </div>
      </form>
      {msg && <div className="mt-3"><Notice kind={msg.kind === "error" ? "error" : "info"}>{msg.text}</Notice></div>}
    </Card>
  );
}
