"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ChainReadNotice } from "@/components/ChainReadNotice";
import { ActionButton, AddressTag, Amount, Card, Field, inputClass, Notice, Skeleton, StatusBadge, useMoney } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { chainName } from "@/lib/chains";
import { fleetVaultAbi, mockUsdtAbi } from "@/lib/contracts";
import { formatUsdt, parseUsdt, shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useRentals } from "@/lib/hooks/useRentals";
import { useTx } from "@/lib/hooks/useTx";
import { useVault, vaultIncome, type VaultState } from "@/lib/hooks/useVault";
import type { ChainEvent } from "@/lib/rentals";
import { Kpi, TxLink, When } from "./shared";

const FAUCET_LIMIT = BigInt(10_000) * BigInt(1_000_000);

/** Investor dashboard for the Fleet Vault: TVL, income, yield, the wallet's shares and claimable income. */
export function Shareholders() {
  const { chainId, deployment } = useDeployment();
  const { address } = useAccount();
  const { data: vault, isLoading, error: vaultError, refetch: refetchVault, isFetching: vaultFetching } = useVault(address);
  const { data: index, error: indexError, refetch, isFetching } = useRentals();
  const money = useMoney();

  if (!deployment) return <Notice kind="warn">KeyEscrow is not deployed on {chainName(chainId)}.</Notice>;
  if (!deployment.fleetVault) {
    return <Notice kind="warn">This deployment has no Fleet Vault yet. Redeploy with `pnpm deploy:testnet` (it now deploys the vault too).</Notice>;
  }
  if (!vault) {
    return vaultError && !isLoading ? (
      <ChainReadNotice error={vaultError} hasData={false} onRetry={() => refetchVault()} retrying={vaultFetching} what="the Fleet Vault" />
    ) : (
      <Skeleton className="h-64" />
    );
  }

  const { earned, yieldPct } = vaultIncome(vault);
  const vaultRentals = (index?.rentals ?? []).filter((r) => r.payee.toLowerCase() === vault.address.toLowerCase());
  const inflows = labelInflows(index?.vaultEvents ?? [], index?.events ?? []);

  return (
    <div className="space-y-6">
      <ChainReadNotice error={indexError} hasData={!!index} stale={index?.stale} block={index?.latestBlock} onRetry={() => refetch()} retrying={isFetching} what="the vault's history" />
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="font-semibold text-foreground">{vault.name}</span>
        <AddressTag address={vault.address} chainId={chainId} label={vault.symbol} />
        <span>· operator fee {(vault.operatorFeeBps / 100).toFixed(0)}% for maintenance</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Vault TVL" testId="vault-tvl" hint="stablecoin held by the vault"><Amount value={vault.totalAssets} /></Kpi>
        <Kpi label="Income to shareholders" testId="vault-earned" hint="rent + damage payouts, after the operator fee"><Amount value={earned} /></Kpi>
        <Kpi label="Yield so far" testId="vault-yield" hint="income ÷ principal, not annualised">
          {yieldPct.toFixed(2)}%
        </Kpi>
        <Kpi label="Shares outstanding" testId="vault-supply" hint={`1 ${vault.symbol} = 1 USDT principal`}>
          {formatUsdt(vault.totalSupply)}
        </Kpi>
      </div>

      <WalletGate what="buy fleet shares and claim income">
        <Position vault={vault} />
      </WalletGate>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Income into the vault">
          {inflows.length === 0 ? (
            <p className="text-sm text-subtle">No income yet. Completed rentals and damage payouts of vault scooters land here.</p>
          ) : (
            <ol className="space-y-2" data-testid="vault-inflows">
              {inflows.map(({ e, kind }) => (
                <li key={`${e.txHash}-${e.logIndex}`} className="flex items-start justify-between gap-3 text-sm" data-testid="vault-inflow" data-kind={kind}>
                  <div>
                    <p>{kind === "damage" ? "Damage payout from a slashed deposit" : kind === "rent" ? "Rental income (owner's cut)" : "Other inflow"}</p>
                    <p className="text-xs text-subtle">
                      <When ts={e.timestamp} /> · <TxLink hash={e.txHash} chainId={chainId} /> · from{" "}
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
        <Card title="Rentals paying this vault">
          {vaultRentals.length === 0 ? (
            <p className="text-sm text-subtle">No rentals routed to the vault yet. Fleet owners tick &ldquo;income to Fleet Vault&rdquo; on a scooter.</p>
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
                    rent {money(r.totals.rentToOwner)} · damage {money(r.totals.slashed)}
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
  const { address } = useAccount();
  const { send, pending } = useTx();
  const [input, setInput] = useState("1000");
  const me = vault.me;
  const amount = parseUsdt(input);
  const share = me && vault.totalSupply > BigInt(0) ? (Number(me.shares) / Number(vault.totalSupply)) * 100 : 0;
  const short = me && amount !== undefined && me.usdt < amount ? amount - me.usdt : BigInt(0);
  const { deployment } = useDeployment();

  return (
    <Card title="Your position">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Your ${vault.symbol}`} testId="my-shares" hint={`${share.toFixed(1)}% of the fleet`}>
          {me ? formatUsdt(me.shares) : "…"}
        </Kpi>
        <Kpi label="Claimable income" testId="my-claimable"><Amount value={me?.claimable ?? BigInt(0)} /></Kpi>
        <Kpi label="Wallet USDT"><Amount value={me?.usdt ?? BigInt(0)} /></Kpi>
        <div className="flex items-end">
          <ActionButton
            className="w-full"
            data-testid="claim-income"
            busy={pending === "Claim income"}
            disabledReason={!me ? "Loading…" : me.claimable === BigInt(0) ? "Nothing to claim yet." : null}
            onClick={() => send("Claim income", { address: vault.address, abi: fleetVaultAbi, functionName: "claim" })}
          >
            Claim income
          </ActionButton>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <Field label="Buy shares (USDT)" hint="1 share per USDT. Principal stays in the vault and can be redeemed 1:1.">
          <input className={inputClass} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} data-testid="deposit-amount" />
        </Field>
        {short > BigInt(0) && deployment && (
          <ActionButton
            variant="secondary"
            busy={pending === "Get test USDT"}
            onClick={() => send("Get test USDT", { address: deployment.mockUsdt, abi: mockUsdtAbi, functionName: "faucet", args: [address!, short > FAUCET_LIMIT ? FAUCET_LIMIT : short] })}
          >
            Get test USDT
          </ActionButton>
        )}
        <ActionButton
          variant="secondary"
          data-testid="approve-vault"
          busy={pending === "Approve USDT"}
          disabledReason={amount === undefined ? "Enter an amount." : me && me.allowance >= amount ? "Approved." : null}
          onClick={() => send("Approve USDT", { address: deployment!.mockUsdt, abi: mockUsdtAbi, functionName: "approve", args: [vault.address, amount!] })}
        >
          Approve
        </ActionButton>
        <ActionButton
          data-testid="deposit-vault"
          busy={pending === "Buy fleet shares"}
          disabledReason={
            amount === undefined || amount === BigInt(0)
              ? "Enter an amount."
              : me && me.usdt < amount
                ? "Not enough USDT."
                : me && me.allowance < amount
                  ? "Approve first."
                  : null
          }
          onClick={() => send("Buy fleet shares", { address: vault.address, abi: fleetVaultAbi, functionName: "deposit", args: [amount!] })}
        >
          Buy shares
        </ActionButton>
      </div>
    </Card>
  );
}
