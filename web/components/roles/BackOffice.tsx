"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { Card, Notice, Skeleton, StatusBadge, useMoney, Amount, AddressTag } from "@/components/ui";
import { LeaseStatus } from "@/lib/contracts";
import { chainName } from "@/lib/chains";
import { shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { useRentals } from "@/lib/hooks/useRentals";
import { useVault, vaultIncome } from "@/lib/hooks/useVault";
import { describeEvent, worstFlag, type ChainEvent, type RentalSummary } from "@/lib/rentals";
import { FlagBadge, Kpi, TxLink, When, useFleet } from "./shared";

type Filter = "all" | "attention" | "open" | "closed";

/**
 * Operator view: every rental of the factory and every transaction, live from chain events, with flags for anything
 * stuck, failed or disputed, and the Fleet Vault's inflows.
 */
export function BackOffice() {
  const t = useT();
  const { chainId, deployment } = useDeployment();
  const { data, error, refetch, isFetching } = useRentals();
  const { data: vault } = useVault();
  const { data: fleet } = useFleet();
  const money = useMoney();
  const [filter, setFilter] = useState<Filter>("all");

  const scooterOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of fleet?.scooters ?? []) for (const r of s.rentals) m.set(r.toLowerCase(), `${s.name} · ${s.location}`);
    return m;
  }, [fleet]);

  if (!deployment) return <Notice kind="warn">{t("backoffice.notDeployed", { chain: chainName(chainId) })}</Notice>;
  if (!data) {
    return error ? (
      <ChainReadNotice error={error} hasData={false} onRetry={() => refetch()} retrying={isFetching} />
    ) : (
      <Skeleton className="h-64" />
    );
  }

  const rentals = data.rentals;
  const open = rentals.filter((r) => r.status === LeaseStatus.Active || r.status === LeaseStatus.MoveOut || r.status === LeaseStatus.Disputed);
  const attention = rentals.filter((r) => worstFlag(r.flags) === "danger" || worstFlag(r.flags) === "warn");
  const locked = rentals.reduce((s, r) => s + r.totals.depositLocked, BigInt(0));
  const paidOut = rentals.reduce((s, r) => s + r.totals.rentToOwner, BigInt(0));
  const slashed = rentals.reduce((s, r) => s + r.totals.slashed, BigInt(0));
  const shown = {
    all: rentals,
    attention,
    open,
    closed: rentals.filter((r) => r.status === LeaseStatus.Settled || r.status === LeaseStatus.Cancelled),
  }[filter];
  const feed = [...data.events].reverse().slice(0, 60);

  return (
    <div className="space-y-6" data-testid="backoffice" data-block={data.latestBlock.toString()}>
      <ChainReadNotice error={error} hasData stale={data.stale} block={data.latestBlock} onRetry={() => refetch()} retrying={isFetching} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("backoffice.kpi.rentals")} testId="kpi-rentals">{rentals.length}</Kpi>
        <Kpi label={t("backoffice.kpi.open")} testId="kpi-open">{open.length}</Kpi>
        <Kpi label={t("backoffice.kpi.attention")} testId="kpi-attention">
          <span className={attention.length ? "text-danger" : ""}>{attention.length}</span>
        </Kpi>
        <Kpi label={t("backoffice.kpi.locked")} testId="kpi-locked"><Amount value={locked} /></Kpi>
        <Kpi label={t("backoffice.kpi.paid")} testId="kpi-paid"><Amount value={paidOut} /></Kpi>
        <Kpi label={t("backoffice.kpi.slashed")} testId="kpi-slashed"><Amount value={slashed} /></Kpi>
      </div>

      <Card
        title={t.h("backoffice.rentals")}
        aside={
          <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label={t("backoffice.filterLabel")}>
            {(["all", "attention", "open", "closed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                data-testid={`filter-${f}`}
                className={`rounded-md px-2.5 py-1 ring-1 ring-inset ring-border ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {t(`backoffice.filter.${f}`, { n: { all: rentals.length, attention: attention.length, open: open.length, closed: 0 }[f] })}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <p className="text-sm text-subtle">{t("backoffice.nothing")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="rental-rows">
            {shown.map((r) => (
              <RentalRow key={r.address} r={r} chainId={chainId} scooter={scooterOf.get(r.address.toLowerCase())} vault={deployment.fleetVault} money={money} />
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title={t.h("backoffice.live")} aside={<span className="text-xs text-subtle">{t("backoffice.liveAside", { block: data.latestBlock.toString() })}</span>}>
          <ol className="space-y-2" data-testid="activity-feed">
            {feed.map((e) => (
              <FeedItem key={`${e.txHash}-${e.logIndex}`} e={e} chainId={chainId} money={money} vault={deployment.fleetVault} />
            ))}
          </ol>
          {!data.scannedFailures && <p className="mt-3 text-xs text-subtle">{t("backoffice.reverted")}</p>}
        </Card>
        <Card title={t.h("backoffice.vaultInflows")}>
          {!deployment.fleetVault || !vault ? (
            <p className="text-sm text-subtle">{t("backoffice.noVault")}</p>
          ) : (
            <div className="space-y-3" data-testid="vault-panel">
              <div className="grid grid-cols-2 gap-2">
                <Kpi label={t("holders.kpi.tvl")} testId="vault-tvl"><Amount value={vault.totalAssets} /></Kpi>
                <Kpi label={t("backoffice.shareholderIncome")} testId="vault-earned"><Amount value={vaultIncome(vault).earned} /></Kpi>
              </div>
              <AddressTag address={vault.address} chainId={chainId} label={vault.symbol} />
              <ol className="space-y-2">
                {[...data.vaultEvents].reverse().slice(0, 20).map((e) => (
                  <FeedItem key={`${e.txHash}-${e.logIndex}`} e={e} chainId={chainId} money={money} vault={deployment.fleetVault} />
                ))}
              </ol>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function RentalRow({ r, chainId, scooter, vault, money }: { r: RentalSummary; chainId: number; scooter?: string; vault?: string; money: (v: bigint) => string }) {
  const t = useT();
  const [openRow, setOpenRow] = useState(false);
  const toVault = vault && r.payee.toLowerCase() === vault.toLowerCase();
  return (
    <li className="py-3" data-testid="rental-row" data-address={r.address} data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            <Link href={`/lease/${r.address}`} className="font-mono text-sm underline-offset-2 hover:underline">
              {shortAddress(r.address)}
            </Link>
            {scooter && <span className="text-sm">{scooter}</span>}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{toVault ? t("backoffice.paysVault") : t("backoffice.paysOwner")}</span>
          </div>
          <p className="text-xs text-subtle">
            {t("backoffice.rowMeta", { owner: shortAddress(r.landlord), renter: shortAddress(r.tenant) })}
            <When ts={r.createdAt} />
          </p>
          {r.flags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.flags.map((f) => (
                <FlagBadge key={f.code} flag={f} />
              ))}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-3 text-right text-xs">
          <div>
            <dt className="text-subtle">{t("backoffice.deposit")}</dt>
            <dd><Amount value={r.depositAmount} /></dd>
          </div>
          <div>
            <dt className="text-subtle">{t("backoffice.rentOut")}</dt>
            <dd><Amount value={r.totals.rentToOwner} /></dd>
          </div>
          <div>
            <dt className="text-subtle">{t("backoffice.slashed")}</dt>
            <dd><Amount value={r.totals.slashed} /></dd>
          </div>
        </dl>
      </div>
      <button className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setOpenRow(!openRow)} data-testid="toggle-tx">
        {t(openRow ? "backoffice.hide" : "backoffice.show", { n: r.events.length })}
      </button>
      {openRow && (
        <ol className="mt-2 space-y-1.5 border-l border-border pl-3" data-testid="rental-tx">
          {r.events.map((e) => (
            <FeedItem key={`${e.txHash}-${e.logIndex}`} e={e} chainId={chainId} money={money} vault={vault} compact />
          ))}
        </ol>
      )}
    </li>
  );
}

function FeedItem({ e, chainId, money, vault, compact }: { e: ChainEvent; chainId: number; money: (v: bigint) => string; vault?: string; compact?: boolean }) {
  const t = useT();
  const isVault = vault && e.address.toLowerCase() === vault.toLowerCase();
  const lease = e.name === "LeaseCreated" || e.name === "PayeeSet" ? (e.args.escrow as string) : isVault || e.name === "Transfer" ? undefined : e.address;
  const tone =
    e.name === "DisputeRaised" ? "bg-danger" : e.name === "Settled" || e.name === "Funded" ? "bg-success" : e.name === "SettlementProposed" ? "bg-info" : isVault || e.name === "Transfer" ? "bg-primary" : "bg-border-strong";
  return (
    <li className="flex items-start gap-2 text-sm" data-testid="tx-event" data-event={e.name}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">{describeEvent(e, money, t)}</p>
        <p className="text-xs text-subtle">
          <When ts={e.timestamp} /> · <TxLink hash={e.txHash} chainId={chainId} />
          {!compact && lease && (
            <>
              {" · "}
              <Link href={`/lease/${lease}`} className="font-mono underline-offset-2 hover:underline">
                {shortAddress(lease)}
              </Link>
            </>
          )}
          {!compact && (isVault || e.name === "Transfer") && t("backoffice.fleetVault")}
        </p>
      </div>
    </li>
  );
}
