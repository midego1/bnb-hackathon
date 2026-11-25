"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { DepositRiskForUsdt } from "@/components/risk/DepositRiskPanel";
import { ActionButton, Amount, Card, PriceSourceBadge } from "@/components/ui";
import { targetChainId } from "@/lib/chains";
import { mockUsdtAbi, rentalEscrowAbi, TOKEN } from "@/lib/contracts";
import { formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { periodName } from "@/lib/rentals";

const FAUCET_LIMIT = BigInt(10_000) * BigInt(10) ** BigInt(TOKEN.decimals); // MockUSDT.FAUCET_LIMIT

/** Renter: get test USDT, approve, fund deposit + the first period's rent. */
export function FundingPanel({ lease }: { lease: LeaseData }) {
  const { address } = useAccount();
  const { data: token } = useTokenState(address, lease.address);
  const { send, pending } = useTx();
  const need = lease.terms.depositAmount + lease.terms.rentAmount;
  const balance = token?.balance;
  const allowance = token?.allowance;
  const short = balance !== undefined && balance < need ? need - balance : BigInt(0);
  const faucetAmount = short > FAUCET_LIMIT ? FAUCET_LIMIT : short;

  return (
    <Card title="Fund the escrow" aside={<PriceSourceBadge />}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Deposit (stays locked)"><Amount value={lease.terms.depositAmount} /></Stat>
        <Stat label={`First ${periodName(lease.terms.rentPeriod)}'s rent`}><Amount value={lease.terms.rentAmount} /></Stat>
        <Stat label="Total to fund"><Amount value={need} /></Stat>
      </div>
      <div className="mb-4"><DepositRiskForUsdt deposit={lease.terms.depositAmount} rentalDays={(lease.terms.termPeriods * lease.terms.rentPeriod) / 86400} /></div>
      <p className="mb-4 text-sm text-muted-foreground">
        Your wallet holds {balance === undefined ? "…" : `${formatUsdt(balance)} USDT`}. Funding takes two wallet steps: approve, then fund.
        The owner can never withdraw the deposit alone; it only leaves the escrow when you both agree or the dispute desk rules.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* BSC mainnet (56) has real USDT: no faucet. */}
        {targetChainId !== 56 && (
          <ActionButton
            variant="secondary"
            busy={pending === "Get test USDT"}
            disabledReason={balance === undefined ? "Loading your balance…" : short === BigInt(0) ? "You already have enough test USDT." : null}
            onClick={() => send("Get test USDT", { address: lease.terms.token, abi: mockUsdtAbi, functionName: "faucet", args: [address!, faucetAmount] })}
            data-testid="faucet"
          >
            Get {formatUsdt(faucetAmount || need)} test USDT
          </ActionButton>
        )}
        <ActionButton
          variant="secondary"
          busy={pending === "Approve USDT"}
          disabledReason={allowance === undefined ? "Loading your wallet…" : allowance >= need ? "Already approved. Now fund." : null}
          onClick={() => send("Approve USDT", { address: lease.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease.address, need] })}
          data-testid="approve"
        >
          Approve {formatUsdt(need)} USDT
        </ActionButton>
        <ActionButton
          busy={pending === "Fund escrow"}
          disabledReason={
            balance === undefined || allowance === undefined
              ? "Loading your wallet…"
              : balance < need
                ? "Not enough USDT in your wallet yet. Get test USDT first."
                : allowance < need
                  ? "Approve the USDT first (middle button)."
                  : null
          }
          onClick={() => send("Fund escrow", { address: lease.address, abi: rentalEscrowAbi, functionName: "fund" })}
          data-testid="fund"
        >
          Fund deposit + rent
        </ActionButton>
      </div>
      <Link href={`/app/pay/${lease.address}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium hover:border-border-hover" data-testid="pay-promptpay">
        Pay with PromptPay (demo)
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
