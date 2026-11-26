"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ActionButton, Card } from "@/components/ui";
import { targetChainId } from "@/lib/chains";
import { mockUsdtAbi, rentalEscrowAbi, TOKEN } from "@/lib/contracts";
import { formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";

const FAUCET_LIMIT = BigInt(10_000) * BigInt(10) ** BigInt(TOKEN.decimals); // MockUSDT.FAUCET_LIMIT

/** Renter: get test USDT, approve, fund deposit + first month. The amounts are in the Money card. */
export function FundingPanel({ lease }: { lease: LeaseData }) {
  const { address } = useAccount();
  const { data: token } = useTokenState(address, lease.address);
  const { send, pending } = useTx();
  const t = useT();
  const tx = { faucet: t("rental.fund.faucetTx"), approve: t("rental.fund.approveTx"), fund: t("rental.fund.fundTx") };
  const need = lease.terms.depositAmount + lease.terms.rentAmount;
  const balance = token?.balance;
  const allowance = token?.allowance;
  const short = balance !== undefined && balance < need ? need - balance : BigInt(0);
  const faucetAmount = short > FAUCET_LIMIT ? FAUCET_LIMIT : short;

  return (
    <Card title={t.h("rental.fund")}>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("rental.fund.wallet", { balance: balance === undefined ? "…" : t("rental.fund.walletAmount", { amount: formatUsdt(balance) }) })}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* BSC mainnet (56) has real USDT: no faucet. */}
        {targetChainId !== 56 && (
          <ActionButton
            variant="secondary"
            busy={pending === tx.faucet}
            disabledReason={balance === undefined ? t("rental.fund.loadingBalance") : short === BigInt(0) ? t("rental.fund.enough") : null}
            onClick={() => send(tx.faucet, { address: lease.terms.token, abi: mockUsdtAbi, functionName: "faucet", args: [address!, faucetAmount] })}
            data-testid="faucet"
          >
            {t("rental.fund.faucet", { amount: formatUsdt(faucetAmount || need) })}
          </ActionButton>
        )}
        <ActionButton
          variant="secondary"
          busy={pending === tx.approve}
          disabledReason={allowance === undefined ? t("rental.fund.loadingWallet") : allowance >= need ? t("rental.fund.approved") : null}
          onClick={() => send(tx.approve, { address: lease.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease.address, need] })}
          data-testid="approve"
        >
          {t("rental.fund.approve", { amount: formatUsdt(need) })}
        </ActionButton>
        <ActionButton
          busy={pending === tx.fund}
          disabledReason={
            balance === undefined || allowance === undefined
              ? t("rental.fund.loadingWallet")
              : balance < need
                ? t("rental.fund.notEnough")
                : allowance < need
                  ? t("rental.fund.approveFirst")
                  : null
          }
          onClick={() => send(tx.fund, { address: lease.address, abi: rentalEscrowAbi, functionName: "fund" })}
          data-testid="fund"
        >
          {t("rental.fund.fund")}
        </ActionButton>
      </div>
      <Link href={`/app/pay/${lease.address}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium hover:border-border-hover" data-testid="pay-promptpay">
        {t("rental.fund.promptpay")}
      </Link>
    </Card>
  );
}

export function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-xs text-subtle">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
