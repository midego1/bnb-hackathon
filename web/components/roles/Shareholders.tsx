"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, AddressTag, Amount, Card, Countdown, Field, inputClass, Notice, Skeleton, StatusBadge, useMoney } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { chainName } from "@/lib/chains";
import { fleetVaultAbi, mockUsdtAbi } from "@/lib/contracts";
import { formatUsdt, parseUsdt, shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { useRentals } from "@/lib/hooks/useRentals";
import { useTx } from "@/lib/hooks/useTx";
import { useVault, vaultIncome, type VaultState } from "@/lib/hooks/useVault";
import type { ChainEvent } from "@/lib/rentals";
import { shareLock } from "@/lib/windows";
import { Kpi, TxLink, When } from "./shared";

const FAUCET_LIMIT = BigInt(10_000) * BigInt(1_000_000);

/** Investor dashboard for the Fleet Vault: TVL, income, yield, the wallet's shares and claimable income. */
export function Shareholders() {
  const t = useT();
  const { chainId, deployment } = useDeployment();
  const { address } = useAccount();
  const { data: vault, isLoading, error: vaultError, refetch: refetchVault, isFetching: vaultFetching } = useVault(address);
  const { data: index, error: indexError, refetch, isFetching } = useRentals();
  const money = useMoney();

  if (!deployment) return <Notice kind="warn">{t("holders.notDeployed", { chain: chainName(chainId) })}</Notice>;
  if (!deployment.fleetVault) {
    return <Notice kind="warn">{t("holders.noVault")}</Notice>;
  }
  if (!vault) {
    return vaultError && !isLoading ? (
      <ChainReadNotice error={vaultError} hasData={false} onRetry={() => refetchVault()} retrying={vaultFetching} what={t("holders.whatVault")} />
    ) : (
      <Skeleton className="h-64" />
    );
  }

  const { earned, yieldPct } = vaultIncome(vault);
  const vaultRentals = (index?.rentals ?? []).filter((r) => r.payee.toLowerCase() === vault.address.toLowerCase());
  const inflows = labelInflows(index?.vaultEvents ?? [], index?.events ?? []);

  return (
    <div className="space-y-6">
      <ChainReadNotice error={indexError} hasData={!!index} stale={index?.stale} block={index?.latestBlock} onRetry={() => refetch()} retrying={isFetching} what={t("holders.whatHistory")} />
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{vault.name}</span>
        <AddressTag address={vault.address} chainId={chainId} label={vault.symbol} />
        <span>{t("holders.operatorFee", { pct: (vault.operatorFeeBps / 100).toFixed(0) })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("holders.kpi.tvl")} testId="vault-tvl" hint={t("holders.kpi.tvlHint")}><Amount value={vault.totalAssets} /></Kpi>
        <Kpi label={t("holders.kpi.earned")} testId="vault-earned" hint={t("holders.kpi.earnedHint")}><Amount value={earned} /></Kpi>
        <Kpi label={t("holders.kpi.yield")} testId="vault-yield" hint={t("holders.kpi.yieldHint")}>
          {yieldPct.toFixed(2)}%
        </Kpi>
        <Kpi label={t("holders.kpi.supply")} testId="vault-supply" hint={t("holders.kpi.supplyHint", { symbol: vault.symbol })}>
          {formatUsdt(vault.totalSupply)}
        </Kpi>
      </div>

      <WalletGate what={t("holders.gate")}>
        <Position vault={vault} />
      </WalletGate>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t.h("holders.income")}>
          {inflows.length === 0 ? (
            <p className="text-sm text-subtle">{t("holders.noIncome")}</p>
          ) : (
            <ol className="space-y-2" data-testid="vault-inflows">
              {inflows.map(({ e, kind }) => (
                <li key={`${e.txHash}-${e.logIndex}`} className="flex items-start justify-between gap-3 text-sm" data-testid="vault-inflow" data-kind={kind}>
                  <div>
                    <p>{t(`holders.inflow.${kind}`)}</p>
                    <p className="text-xs text-subtle">
                      <When ts={e.timestamp} /> · <TxLink hash={e.txHash} chainId={chainId} /> · {t("holders.inflow.from")}{" "}
                      <Link className="font-mono underline-offset-2 hover:underline" href={`/lease/${String(e.args.from)}`}>
                        {shortAddress(String(e.args.from))}
                      </Link>
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">{money(e.args.value as bigint)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title={t.h("holders.paying")}>
          {vaultRentals.length === 0 ? (
            <p className="text-sm text-subtle">{t("holders.noRentals")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {vaultRentals.map((r) => (
                <li key={r.address} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <Link className="font-mono underline-offset-2 hover:underline" href={`/lease/${r.address}`}>
                      {shortAddress(r.address)}
                    </Link>
                  </span>
                  <span className="text-xs text-subtle">
                    {t("holders.rentDamage", { rent: money(r.totals.rentToOwner), damage: money(r.totals.slashed) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Labels each token transfer into the vault by what the escrow did in the same transaction. */
function labelInflows(vaultEvents: ChainEvent[], all: ChainEvent[]) {
  const byTx = new Map<string, ChainEvent[]>();
  for (const e of all) byTx.set(e.txHash, [...(byTx.get(e.txHash) ?? []), e]);
  return vaultEvents
    .filter((e) => e.name === "Transfer")
    .reverse()
    .map((e) => {
      const siblings = byTx.get(e.txHash) ?? [];
      const settled = siblings.find((s) => s.name === "Settled");
      const kind: "damage" | "rent" | "other" =
        settled && (settled.args.landlordClaim as bigint) > BigInt(0) && (settled.args.landlordClaim as bigint) === (e.args.value as bigint)
          ? "damage"
          : siblings.some((s) => s.name === "RentReleased" || s.name === "Settled")
            ? "rent"
            : "other";
      return { e, kind };
    });
}

function Position({ vault }: { vault: VaultState }) {
  const t = useT();
  const { address } = useAccount();
  const { send, pending } = useTx();
  const [input, setInput] = useState("1000");
  const me = vault.me;
  const amount = parseUsdt(input);
  const share = me && vault.totalSupply > BigInt(0) ? (Number(me.shares) / Number(vault.totalSupply)) * 100 : 0;
  const short = me && amount !== undefined && me.usdt < amount ? amount - me.usdt : BigInt(0);
  const { deployment } = useDeployment();
  const lock = shareLock(me?.lockedUntil ?? BigInt(0), vault.chainNow);

  return (
    <Card title={t.h("holders.position")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("holders.myShares", { symbol: vault.symbol })} testId="my-shares" hint={t("holders.shareOf", { pct: share.toFixed(1) })}>
          {me ? formatUsdt(me.shares) : "…"}
        </Kpi>
        <Kpi label={t("holders.claimable")} testId="my-claimable"><Amount value={me?.claimable ?? BigInt(0)} /></Kpi>
        <Kpi label={t("holders.wallet")}><Amount value={me?.usdt ?? BigInt(0)} /></Kpi>
        <div className="flex items-end">
          <ActionButton
            className="w-full"
            data-testid="claim-income"
            busy={pending === t("holders.claim")}
            disabledReason={!me ? t("holders.loading") : me.claimable === BigInt(0) ? t("holders.nothingToClaim") : null}
            onClick={() => send(t("holders.claim"), { address: vault.address, abi: fleetVaultAbi, functionName: "claim" })}
          >
            {t("holders.claim")}
          </ActionButton>
        </div>
      </div>
      {lock.locked && (
        <div className="mt-4" data-testid="share-lock">
          <Notice kind="info">
            {lock.reason} {t("holders.unlocks")} <Countdown target={lock.until} clock={vault} />.
          </Notice>
        </div>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <Field label={t("holders.buyLabel")} hint={t("holders.buyHint")}>
          <input className={inputClass} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} data-testid="deposit-amount" />
        </Field>
        {short > BigInt(0) && deployment && (
          <ActionButton
            variant="secondary"
            busy={pending === t("holders.getUsdt")}
            onClick={() => send(t("holders.getUsdt"), { address: deployment.mockUsdt, abi: mockUsdtAbi, functionName: "faucet", args: [address!, short > FAUCET_LIMIT ? FAUCET_LIMIT : short] })}
          >
            {t("holders.getUsdt")}
          </ActionButton>
        )}
        <ActionButton
          variant="secondary"
          data-testid="approve-vault"
          busy={pending === t("holders.approveTx")}
          disabledReason={amount === undefined ? t("holders.enterAmount") : me && me.allowance >= amount ? t("holders.approved") : null}
          onClick={() => send(t("holders.approveTx"), { address: deployment!.mockUsdt, abi: mockUsdtAbi, functionName: "approve", args: [vault.address, amount!] })}
        >
          {t("holders.approve")}
        </ActionButton>
        <ActionButton
          data-testid="deposit-vault"
          busy={pending === t("holders.buyTx")}
          disabledReason={
            amount === undefined || amount === BigInt(0)
              ? t("holders.enterAmount")
              : me && me.usdt < amount
                ? t("holders.notEnough")
                : me && me.allowance < amount
                  ? t("holders.approveFirst")
                  : null
          }
          onClick={() => send(t("holders.buyTx"), { address: vault.address, abi: fleetVaultAbi, functionName: "deposit", args: [amount!] })}
        >
          {t("holders.buy")}
        </ActionButton>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">{t("holders.redeemText", { shares: me ? formatUsdt(me.shares) : "…", symbol: vault.symbol })}</p>
        <ActionButton
          variant="secondary"
          data-testid="redeem-shares"
          busy={pending === t("holders.redeem")}
          disabledReason={!me || me.shares === BigInt(0) ? t("holders.noShares") : lock.reason}
          onClick={() => send(t("holders.redeem"), { address: vault.address, abi: fleetVaultAbi, functionName: "redeem", args: [me!.shares] })}
        >
          {t("holders.redeem")}
        </ActionButton>
      </div>
    </Card>
  );
}
