"use client";

import { useAccount } from "wagmi";
import { ActionButton, Amount, Card } from "@/components/ui";
import { mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";

const FAUCET_LIMIT = BigInt(10_000) * BigInt(1_000_000);

/** Tenant: get test USDT, approve, fund deposit + first month. */
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
    <Card title="Fund the escrow" aside={<span className="text-xs text-slate-500">Step 1 of 1 to move in</span>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Deposit (locked)"><Amount value={lease.terms.depositAmount} /></Stat>
        <Stat label="First month's rent"><Amount value={lease.terms.rentAmount} /></Stat>
        <Stat label="Total to fund"><Amount value={need} /></Stat>
      </div>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Your wallet: {balance === undefined ? "…" : `${formatUsdt(balance)} USDT`}. The landlord can never withdraw the deposit alone; it only
        leaves the escrow when you both agree or the arbiter rules.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <ActionButton
          variant="secondary"
          busy={pending === "Get test USDT"}
          disabledReason={balance === undefined ? "Loading balance…" : short === BigInt(0) ? "You have enough USDT." : null}
          onClick={() => send("Get test USDT", { address: lease.terms.token, abi: mockUsdtAbi, functionName: "faucet", args: [address!, faucetAmount] })}
          data-testid="faucet"
        >
          Get {formatUsdt(faucetAmount || need)} test USDT
        </ActionButton>
        <ActionButton
          variant="secondary"
          busy={pending === "Approve USDT"}
          disabledReason={allowance === undefined ? "Loading…" : allowance >= need ? "Already approved." : null}
          onClick={() => send("Approve USDT", { address: lease.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease.address, need] })}
          data-testid="approve"
        >
          Approve {formatUsdt(need)} USDT
        </ActionButton>
        <ActionButton
          busy={pending === "Fund escrow"}
          disabledReason={
            balance === undefined || allowance === undefined
              ? "Loading…"
              : balance < need
                ? "Not enough USDT in your wallet yet."
                : allowance < need
                  ? "Approve USDT first."
                  : null
          }
          onClick={() => send("Fund escrow", { address: lease.address, abi: rentalEscrowAbi, functionName: "fund" })}
          data-testid="fund"
        >
          Fund deposit + rent
        </ActionButton>
      </div>
    </Card>
  );
}

export function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
