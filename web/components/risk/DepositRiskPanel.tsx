"use client";

import { formatFiat, toFiat } from "@/lib/fiat";
import { useT } from "@/lib/i18n/client";
import { usePrices } from "@/lib/usePrices";
import { useRisk } from "@/lib/useRisk";
import type { RiskAsset } from "@/lib/risk";
import { Notice, Skeleton } from "@/components/ui";
import { CournotEvidence } from "./CournotEvidence";

const pct = (f: number) => `${(f * 100).toFixed(f > 0 && f < 0.1 ? 1 : 0)}%`;

/**
 * Risk engine view: deposit buffer per payment token from live CoinMarketCap volatility, scaled by the
 * Cournot probability. Shows "not configured" (and no numbers) when the server has no CMC key.
 */
export function DepositRiskPanel({ depositThb, rentalDays, onApply }: { depositThb: number | null; rentalDays: number; onApply?: (asset: RiskAsset, depositThb: number) => void }) {
  const { data, error, isLoading } = useRisk(depositThb, rentalDays);
  const t = useT();
  if (!depositThb) return null;
  if (isLoading) return <Skeleton className="h-28" />;
  if (error || !data) return <Notice kind="error">{t("risk.unavailable", { error: (error as Error | null)?.message ?? t("risk.noResponse") })}</Notice>;

  return (
    <div className="space-y-3" data-testid="risk-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t.h("risk.title")}</p>
        <span className="text-xs text-subtle">
          CoinMarketCap
          {data.cmc.configured && data.cmc.ok
            ? t("risk.quotes", { time: new Date(data.cmc.fetchedAt).toLocaleTimeString(t.lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" }) }) +
              (data.cmc.cached ? t("risk.cached") : "")
            : ""}{" "}
          · Cournot
        </span>
      </div>
      {!data.cmc.configured ? (
        <div data-testid="cmc-not-configured">
          <Notice kind="warn">{t("risk.notConfigured", { reason: String(data.cmc.reason) })}</Notice>
        </div>
      ) : !data.cmc.ok ? (
        <Notice kind="error">{t("risk.cmcFailed", { error: String(data.cmc.error) })}</Notice>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["USDT", "BNB"] as const).map((a) => {
            const o = data.options![a];
            return (
              <div key={a} className="rounded-xl bg-muted p-3 text-sm" data-testid={`risk-${a}`}>
                <div className="flex items-center justify-between">
                  <p className="font-medium">{t("risk.paidIn", { asset: a })}</p>
                  <span className="text-xs text-subtle">{o.tier}</span>
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`risk-${a}-deposit`}>{formatFiat(o.depositThb, "THB")}</p>
                <p className="text-xs text-subtle tabular-nums">
                  {o.depositTokens.toLocaleString("en-US", { maximumFractionDigits: a === "BNB" ? 4 : 2 })} {a}
                  {t("risk.buffer")}
                  <span data-testid={`risk-${a}-buffer`}>{pct(o.buffer)}</span>
                  {o.cournotBuffer > 0 && t("risk.split", { cmc: pct(o.cmcBuffer), cournot: pct(o.cournotBuffer) })}
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {o.explanation.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                {onApply && o.tier !== "rejected" && o.buffer > 0 && (
                  <button type="button" className="mt-2 text-xs font-medium underline-offset-4 hover:underline" onClick={() => onApply(a, o.depositThb)}>
                    {t("risk.use")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <CournotEvidence view={data.cournot} cmcBuffer={data.options?.BNB.cmcBuffer} cournotBuffer={data.options?.BNB.cournotBuffer} />
    </div>
  );
}

/** Same panel for an on-chain USDT amount (base units): converts to THB with /api/price first. */
export function DepositRiskForUsdt({ deposit, rentalDays }: { deposit: bigint | undefined; rentalDays: number }) {
  const { prices } = usePrices();
  const thb = deposit ? toFiat(deposit, "USDT", "THB", prices) : null;
  return <DepositRiskPanel depositThb={thb} rentalDays={Number.isFinite(rentalDays) && rentalDays > 0 ? rentalDays : 30} />;
}
