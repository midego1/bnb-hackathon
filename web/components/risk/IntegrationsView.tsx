"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, Field, inputClass, PageTitle, Skeleton } from "@/components/ui";
import type { IntegrationStatus } from "@/lib/server/sponsors/status";
import { DepositRiskPanel } from "./DepositRiskPanel";

const STATE: Record<IntegrationStatus["state"], { text: string; className: string }> = {
  live: { text: "Live", className: "bg-success-soft text-success-fg ring-success-border" },
  "not-configured": { text: "Not configured", className: "bg-warning-soft text-warning-fg ring-warning-border" },
  blocked: { text: "Blocked", className: "bg-danger-soft text-danger ring-danger-border" },
  off: { text: "Live calls off", className: "bg-surface-muted text-muted ring-border" },
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
  return (
    <div className="space-y-6">
      <PageTitle title="Integrations">
        How CoinMarketCap, Cournot, Atlas and Living Brain feed the rental risk engine and the AI inspector, with each server-side call
        logged (endpoint, time, status; never a key).
      </PageTitle>
      <Card title="Risk engine on a sample deposit">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Deposit (THB)">
            <input className={inputClass} inputMode="decimal" value={thb} onChange={(e) => setThb(e.target.value)} data-testid="sample-deposit" />
          </Field>
          <Field label="Rental length (days)">
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
                  {STATE[i.state].text}
                </span>
              }
            >
              <p className="text-sm text-muted">{i.detail}</p>
              <p className="mt-2 text-xs text-subtle">
                Env (server-side, web/.env.local): {i.env.map((e) => <code key={e} className="mr-1 rounded bg-surface-muted px-1">{e}</code>)}
              </p>
              <p className="mt-3 text-xs font-semibold">Recent calls</p>
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
                <p className="mt-1 text-xs text-subtle">No calls logged by this server yet.</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
