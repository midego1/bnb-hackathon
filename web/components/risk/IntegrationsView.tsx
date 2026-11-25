"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, Field, inputClass, PageTitle, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { IntegrationStatus } from "@/lib/server/sponsors/status";
import { DepositRiskPanel } from "./DepositRiskPanel";

/** The chip text is `integrations.state.<state>` in the dictionary. */
const STATE: Record<IntegrationStatus["state"], { className: string }> = {
  live: { className: "bg-success-soft text-success-fg ring-success-border" },
  "not-configured": { className: "bg-warning-soft text-warning-fg ring-warning-border" },
  blocked: { className: "bg-danger-soft text-danger ring-danger-border" },
  off: { className: "bg-muted text-muted-foreground ring-border" },
};

/** Sponsor integrations: status, env var names, the risk engine on a sample deposit, and the call log (evidence). */
export function IntegrationsView() {
  const [thb, setThb] = useState("3000");
  const [days, setDays] = useState("30");
  const { data } = useQuery({
    queryKey: ["integrations"],
    queryFn: async (): Promise<{ integrations: IntegrationStatus[] }> => (await fetch("/api/integrations")).json(),
    refetchInterval: 15_000,
  });
  const depositThb = Number(thb);
  const t = useT();
  return (
    <div className="space-y-6">
      <PageTitle title={t.h("integrations.title")}>{t("integrations.lead")}</PageTitle>
      <Card title={t.h("integrations.sample")}>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("integrations.deposit")}>
            <input className={inputClass} inputMode="decimal" value={thb} onChange={(e) => setThb(e.target.value)} data-testid="sample-deposit" />
          </Field>
          <Field label={t("integrations.days")}>
            <input className={inputClass} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <DepositRiskPanel depositThb={Number.isFinite(depositThb) && depositThb > 0 ? depositThb : null} rentalDays={Number(days) || 30} />
      </Card>
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.integrations.map((i) => (
            <Card
              key={i.id}
              title={i.name}
              aside={
                <span data-testid={`integration-${i.id}`} data-state={i.state} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATE[i.state].className}`}>
                  {t(`integrations.state.${i.state}`)}
                </span>
              }
            >
              <p className="text-sm text-muted-foreground">{i.detail}</p>
              <p className="mt-2 text-xs text-subtle">{t("integrations.env")}</p>
              <p className="mt-1 flex flex-wrap gap-1 text-xs">
                {i.env.map((e) => <code key={e} className="break-all rounded bg-muted px-1">{e}</code>)}
              </p>
              <p className="mt-3 text-xs font-semibold">{t("integrations.calls")}</p>
              {i.calls.length ? (
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px]">
                  {i.calls.map((c, n) => (
                    <li key={n} className={c.ok ? "" : "text-danger"}>
                      {c.at.replace("T", " ").slice(0, 19)}Z · {c.status ?? "ERR"} · {c.ms}ms · {c.endpoint}
                      {c.note ? ` · ${c.note}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-subtle">{t("integrations.noCalls")}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
