"use client";

import { ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConfirm } from "@/components/ConfirmDialog";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { FlagBadge, useFleet } from "@/components/roles/shared";
import { ScooterStateBadge, thbToUsdt } from "@/components/roles/FleetOwner";
import { ActionButton, Amount, useMoney } from "@/components/ui";
import { mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { postFleet, scooterState, type Rhythm, type Scooter } from "@/lib/fleet";
import { formatDate } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useRentals } from "@/lib/hooks/useRentals";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { usePrices } from "@/lib/usePrices";
import { nextPayment, RHYTHMS, subState, subscriptionsOf, type Subscription } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";
import { copy } from "./copy";

const FAUCET_LIMIT = BigInt(10_000) * BigInt(1_000_000);
const thb = (n: number) => `฿${n.toLocaleString("en-US")}`;

/** Fleet data + rentals joined into subscriptions, for the renter page, the owner card and the shareholders KPI. */
export function useSubscriptions() {
  const { data: fleet } = useFleet();
  const rentals = useRentals();
  const subs = useMemo(() => subscriptionsOf(fleet, rentals.data?.rentals ?? []), [fleet, rentals.data]);
  return { fleet, rentals, subs, now: rentals.data?.chainNow ?? BigInt(0) };
}

/** The payment rhythm picker. Only the rhythms in RHYTHMS are offered; contract v2 adds weekly and every 2 weeks. */
export function RhythmPicker({ value, onChange }: { value: Rhythm; onChange?: (r: Rhythm) => void }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{copy.rhythmLabel}</span>
      <div role="radiogroup" aria-label={copy.rhythmLabel} className="inline-flex w-fit rounded-lg border border-border p-0.5">
        {RHYTHMS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            onClick={() => onChange?.(r)}
            className={cn("rounded-md px-3 py-1.5 text-sm", value === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {copy.rhythm[r]}
          </button>
        ))}
      </div>
      <span className="text-xs text-subtle">{copy.rhythmSoon}</span>
    </div>
  );
}

/** Renter: subscription plans to pick from, and the wallet's own subscriptions with pay and cancel. */
export function SubscriptionsView() {
  const { address } = useAccount();
  const { fleet, rentals, subs, now } = useSubscriptions();
  const { data: index, error, refetch, isFetching } = rentals;
  const me = address?.toLowerCase();
  const rentalMap = useMemo(() => new Map((index?.rentals ?? []).map((r) => [r.address.toLowerCase(), r])), [index]);
  const plans = (fleet?.scooters ?? []).filter((s) => s.plan).map((s) => ({ s, state: scooterState(s, rentalMap, fleet?.bookings).state }));
  const mine = subs.filter((s) => s.booking.renter.toLowerCase() === me).reverse();

  return (
    <div className="space-y-8">
      <ChainReadNotice error={error} hasData={!!index} stale={index?.stale} block={index?.latestBlock} onRetry={() => refetch()} retrying={isFetching} what="your subscriptions" />
      <section>
        <h2 className="mb-3 text-lg font-semibold">{copy.mine.title}</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-subtle">{copy.mine.empty}</p>
        ) : (
          <ul className="space-y-3" data-testid="my-subscriptions">
            {mine.map((s) => <MySubscription key={s.booking.id} sub={s} now={now} />)}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">{copy.plans.title}</h2>
        {plans.length === 0 ? (
          <p className="text-sm text-subtle">{copy.plans.empty}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="subscription-plans">
            {plans.map(({ s, state }) => (
              <PlanCard key={s.id} s={s} state={state} requested={mine.some((m) => m.booking.scooterId === s.id && m.booking.status === "requested")} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlanCard({ s, state, requested }: { s: Scooter; state: ReturnType<typeof scooterState>["state"]; requested: boolean }) {
  const { address } = useAccount();
  const { chainId } = useDeployment();
  const { prices } = usePrices();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = s.plan!;
  const rate = prices?.rates.USDT.THB;

  async function subscribe() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await postFleet(chainId, { action: "subscribe", scooterId: s.id, renter: address });
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border" data-testid="plan-card" data-scooter={s.id}>
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
          <span className="text-lg font-semibold">{thb(plan.priceThb)}</span>
          <span className="text-subtle"> / {copy.per[plan.periodDays]} · {copy.rhythm[plan.periodDays]}</span>
        </p>
        <p className="text-xs text-muted-foreground">{copy.plans.deposit(thb(plan.depositThb))}</p>
        <p className="text-xs text-muted-foreground">{copy.plans.term(plan.maxPeriods)}</p>
        <p className="text-xs text-subtle">
          {copy.plans.upfront}: <Amount value={thbToUsdt(plan.priceThb, rate) + thbToUsdt(plan.depositThb, rate)} className="inline-flex" />
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <ActionButton
          className="w-full"
          busy={busy}
          data-testid="subscribe"
          disabledReason={!address ? copy.plans.connect : requested ? copy.plans.requested : state !== "available" ? copy.plans.notAvailable : null}
          onClick={subscribe}
        >
          {copy.plans.subscribe}
        </ActionButton>
      </div>
    </li>
  );
}

function MySubscription({ sub, now }: { sub: Subscription; now: bigint }) {
  const { address } = useAccount();
  const router = useRouter();
  const money = useMoney();
  const { send, pending } = useTx();
  const usdt = useDeployment().deployment?.mockUsdt;
  const { confirm, dialog } = useConfirm();
  const r = sub.rental;
  const { data: token } = useTokenState(r ? address : undefined, r?.address);
  const state = subState(sub);
  const next = r ? nextPayment(r, now) : undefined;

  const sentence =
    state === "active"
      ? next
        ? (next.overdue ? copy.state.overdue : copy.state.active)(formatDate(next.due), money(next.amount))
        : copy.state.activePaid()
      : copy.state[state]();

  // Start = deposit + month 1 (fund); afterwards one month at a time (payRent(1)).
  const amount = !r ? BigInt(0) : state === "issued" ? r.depositAmount + r.rentAmount : (next?.amount ?? BigInt(0));
  const label = state === "issued" ? copy.mine.start : next ? copy.mine.pay(next.period) : "";
  const short = token && token.balance < amount ? amount - token.balance : BigInt(0);

  async function pay() {
    if (!r || !token || !usdt) return;
    if (token.allowance < amount) {
      const ok = await send("Approve USDT", { address: usdt!, abi: mockUsdtAbi, functionName: "approve", args: [r.address, amount] });
      if (!ok) return;
    }
    if (state === "issued") await send(label, { address: r.address, abi: rentalEscrowAbi, functionName: "fund" });
    else await send(label, { address: r.address, abi: rentalEscrowAbi, functionName: "payRent", args: [1] });
  }

  async function cancel() {
    if (!r) return;
    const ok = await confirm({ title: copy.mine.cancelTitle, description: copy.mine.cancelBody, confirmLabel: copy.mine.cancelConfirm, destructive: true });
    if (ok) router.push(`/lease/${r.address}`);
  }

  return (
    <li className="rounded-2xl border border-border p-4" data-testid="my-subscription" data-state={state} data-address={r?.address}>
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{sub.scooter ? `${sub.scooter.name} · ${sub.scooter.location}` : copy.pageTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="subscription-status">{sentence}</p>
          {/* "rent-due" asks someone to pay out rent already in escrow: owner news, not the renter's. */}
          {r && <div className="mt-1 flex flex-wrap gap-1">{r.flags.filter((f) => f.code !== "rent-due").map((f) => <FlagBadge key={f.code} flag={f} />)}</div>}
        </div>
        {r && (
          <Link href={`/lease/${r.address}`} className="text-sm font-medium underline-offset-2 hover:underline">
            {copy.mine.open} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />
          </Link>
        )}
      </div>

      {r && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="text-xs text-subtle">{copy.mine.nextPayment}</p>
            {next || state === "issued" ? (
              <>
                <Amount value={amount} />
                {next && <p className="mt-1 text-xs text-subtle" data-testid="next-due">{formatDate(next.due)}</p>}
              </>
            ) : (
              <p className="text-subtle">—</p>
            )}
          </div>
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="text-xs text-subtle">{copy.rhythm[sub.plan.periodDays]}</p>
            <p className="font-semibold" data-testid="months-paid">{copy.mine.paidThrough(r.monthsFunded, r.termMonths)}</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="text-xs text-subtle">{copy.mine.deposit}</p>
            <Amount value={r.depositAmount} />
          </div>
        </div>
      )}

      {r && (state === "issued" || state === "active") && (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          {short > BigInt(0) && (
            <ActionButton
              variant="secondary"
              busy={pending === "Get test USDT"}
              onClick={() => send("Get test USDT", { address: usdt!, abi: mockUsdtAbi, functionName: "faucet", args: [address!, short > FAUCET_LIMIT ? FAUCET_LIMIT : short] })}
              data-testid="sub-faucet"
            >
              {copy.mine.getUsdt}
            </ActionButton>
          )}
          {(state === "issued" || next) && (
            <ActionButton
              busy={!!pending && pending !== "Get test USDT"}
              disabledReason={!token ? copy.mine.loading : short > BigInt(0) ? copy.mine.notEnough : null}
              onClick={pay}
              data-testid="sub-pay"
            >
              {label}
            </ActionButton>
          )}
          {state === "active" && (
            <ActionButton variant="danger" onClick={cancel} data-testid="sub-cancel">
              {copy.mine.cancel}
            </ActionButton>
          )}
        </div>
      )}
      {state === "active" && <p className="mt-2 text-xs text-subtle">{copy.mine.payHint}</p>}
    </li>
  );
}
