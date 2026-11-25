"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { Kpi } from "@/components/roles/shared";
import { ActionButton, Amount, Card, Field, inputClass, Notice } from "@/components/ui";
import { TOKEN } from "@/lib/contracts";
import { postFleet, type Rhythm, type Scooter } from "@/lib/fleet";
import { formatUsdt } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { DEFAULT_MAX_PERIODS, isActive, mrr } from "@/lib/subscriptions";
import { useSubsCopy } from "./copy";
import { RhythmPicker, useSubscriptions } from "./Subscriptions";

const thb = (n: number) => `฿${n.toLocaleString("en-US")}`;

/** Shareholders: MRR of the active subscriptions whose income goes to `payee` (the Fleet Vault). */
export function PayeeMrrKpi({ payee }: { payee: string }) {
  const copy = useSubsCopy();
  const { subs, now } = useSubscriptions();
  const { mrr: total, subscribers } = mrr(subs.filter((s) => s.rental?.payee.toLowerCase() === payee.toLowerCase()), now);
  return (
    <Kpi label={copy.shareholders.mrr} testId="vault-mrr" hint={`${copy.shareholders.hint(subscribers)} · ${formatUsdt(total)} ${TOKEN.symbol}`}>
      <Amount value={total} />
    </Kpi>
  );
}

/** Fleet owner: MRR from active subscriptions, plan cards, and "Offer as subscription" on a listed scooter. */
export function OwnerSubscriptions() {
  const { address } = useAccount();
  const copy = useSubsCopy();
  const { fleet, subs, now } = useSubscriptions();
  const me = address?.toLowerCase();
  const scooters = (fleet?.scooters ?? []).filter((s) => s.owner.toLowerCase() === me);
  const mySubs = subs.filter((s) => s.rental?.landlord.toLowerCase() === me);
  const { mrr: total, subscribers } = mrr(mySubs, now);

  const [scooterId, setScooterId] = useState("");
  const picked = scooters.find((x) => x.id === scooterId) ?? scooters[0];

  const plans = scooters.filter((s) => s.plan);
  return (
    <Card title={copy.owner.title}>
      <div className="grid grid-cols-2 gap-3">
        <Kpi label={copy.owner.mrr} testId="kpi-mrr" hint={copy.owner.mrrHint(formatUsdt(total))}>
          <Amount value={total} />
        </Kpi>
        <Kpi label={copy.owner.subscribers} testId="kpi-subscribers">{subscribers}</Kpi>
      </div>

      {plans.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="owner-plans">
          {plans.map((s) => {
            const p = s.plan!;
            const active = mySubs.filter((x) => x.scooter?.id === s.id && isActive(x.rental, now)).length;
            return (
              <li key={s.id} className="rounded-xl border border-border p-3 text-sm" data-testid="owner-plan" data-scooter={s.id}>
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs text-subtle">{s.location}</p>
                <p className="mt-2">
                  <span className="font-semibold">{thb(p.priceThb)}</span>
                  <span className="text-subtle"> / {copy.per[30]} · {copy.rhythm[p.periodDays]} · {copy.owner.depositShort(thb(p.depositThb))} · {copy.owner.planCard(p.maxPeriods, p.periodDays)}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{copy.owner.subscriberOf(active)}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-subtle">{copy.owner.plansEmpty}</p>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-semibold">{copy.owner.offerTitle}</h3>
        {!picked ? (
          <p className="text-sm text-subtle">{copy.owner.noScooters}</p>
        ) : (
          <PlanForm key={picked.id} scooter={picked} scooters={scooters} onPick={setScooterId} />
        )}
      </div>
    </Card>
  );
}

/** Keyed by scooter, so the fields start from that scooter's plan (or its listing price) when the pick changes. */
function PlanForm({ scooter, scooters, onPick }: { scooter: Scooter; scooters: Scooter[]; onPick: (id: string) => void }) {
  const { chainId } = useDeployment();
  const queryClient = useQueryClient();
  const copy = useSubsCopy();
  const [price, setPrice] = useState(String(scooter.plan?.priceThb ?? scooter.rentThb));
  const [deposit, setDeposit] = useState(String(scooter.plan?.depositThb ?? scooter.depositThb));
  const [months, setMonths] = useState(String(scooter.plan?.maxPeriods ?? DEFAULT_MAX_PERIODS));
  const [rhythm, setRhythm] = useState<Rhythm>(scooter.plan?.periodDays ?? 30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const plan = { priceThb: Number(price), depositThb: Number(deposit), maxPeriods: Number(months), periodDays: rhythm };
      await postFleet(chainId, { action: "offerPlan", scooterId: scooter.id, plan });
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
      setMsg({ kind: "info", text: copy.owner.saved(scooter.name) });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="offer-plan-form">
        <Field label={copy.owner.scooter}>
          <select className={inputClass} name="scooter" value={scooter.id} onChange={(e) => onPick(e.target.value)}>
            {scooters.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.location}</option>)}
          </select>
        </Field>
        <Field label={copy.owner.price}>
          <input className={inputClass} name="priceThb" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} required />
        </Field>
        <Field label={copy.owner.deposit}>
          <input className={inputClass} name="depositThb" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ""))} required />
        </Field>
        <Field label={copy.owner.maxMonths} hint={copy.owner.maxMonthsHint}>
          <input className={inputClass} name="maxMonths" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} required />
        </Field>
        <div className="sm:col-span-2"><RhythmPicker value={rhythm} onChange={setRhythm} /></div>
        <div className="flex items-end justify-end sm:col-span-2">
          <ActionButton type="submit" busy={busy} data-testid="offer-plan">{copy.owner.save}</ActionButton>
        </div>
      </form>
      {msg && <div className="mt-3"><Notice kind={msg.kind === "error" ? "error" : "info"}>{msg.text}</Notice></div>}
    </>
  );
}
