"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ActionButton, Card, Countdown, inputClass, useMoney } from "@/components/ui";
import { LeaseStatus, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { formatDate, formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { periodCount, periodName } from "@/lib/rentals";
import { nextDue, releasablePeriods, type Viewer } from "./model";
import { Stat } from "./FundingPanel";

/** Rent schedule: release funded rent; renter can prepay further rent periods. */
export function RentPanel({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { address } = useAccount();
  const { send, pending } = useTx();
  const { data: token } = useTokenState(viewer === "tenant" ? address : undefined, lease.address);
  const [periods, setPeriods] = useState("1");
  const money = useMoney();
  const per = periodName(lease.terms.rentPeriod);
  const count = (k: number) => periodCount(k, lease.terms.rentPeriod);

  const releasable = releasablePeriods(lease, viewer);
  const due = nextDue(lease);
  const fundedAhead = lease.periodsFunded - lease.periodsReleased;
  const remainingToFund = lease.terms.termPeriods - lease.periodsFunded;
  const n = Number(periods);
  const prepay = Number.isInteger(n) && n > 0 ? lease.terms.rentAmount * BigInt(n) : BigInt(0);
  const canPrepay = viewer === "tenant" && lease.status === LeaseStatus.Active;

  const releaseReason =
    releasable > 0
      ? null
      : lease.periodsReleased >= lease.terms.termPeriods
        ? "All rent for the term has been paid out."
        : fundedAhead === 0
          ? `No paid-in rent left in escrow. The renter needs to prepay the next ${per} first.`
          : due
            ? `The next ${per} is paid in but not due until ${formatDate(due)}.`
            : "Nothing to pay out yet.";

  return (
    <Card title="Rent" aside={<span className="text-xs text-subtle">{money(lease.terms.rentAmount)} / {per}</span>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Paid out to owner">
          <span className="font-semibold" data-testid="months-released">{lease.periodsReleased}</span> / {lease.terms.termPeriods} rent periods
        </Stat>
        <Stat label="Paid into escrow">
          <span className="font-semibold">{lease.periodsFunded}</span> / {lease.terms.termPeriods} rent periods
        </Stat>
        <Stat label="Next due">
          {due ? (
            <span className="text-sm">
              {formatDate(due)} · <Countdown target={due} clock={lease} doneText="due now" />
            </span>
          ) : (
            <span className="text-sm">—</span>
          )}
        </Stat>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionButton
          busy={pending === "Release rent"}
          disabledReason={releaseReason}
          onClick={() => send("Release rent", { address: lease.address, abi: rentalEscrowAbi, functionName: "releaseRent" })}
          data-testid="release-rent"
        >
          Pay out {releasable > 0 ? count(releasable) : "rent"} to owner
        </ActionButton>
        {viewer === "tenant" && releasable > 0 && lease.periodsDue < lease.periodsFunded && (
          <p className="text-xs text-subtle sm:col-span-2">As the renter you may pay out prepaid rent early. Once rent is due, anyone can trigger the payout.</p>
        )}
      </div>
      {canPrepay && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-sm font-medium">Prepay rent</p>
          <p className="mb-2 text-xs text-subtle">Paid into escrow now, paid out to the owner only as each {per} comes due. Two wallet steps: approve, then pay.</p>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr] sm:items-start">
            <input type="number" min={1} max={remainingToFund} className={inputClass} value={periods} onChange={(e) => setPeriods(e.target.value)} aria-label="Rent periods to prepay" />
            <ActionButton
              variant="secondary"
              busy={pending === "Approve rent"}
              disabledReason={
                remainingToFund === 0
                  ? "The whole term is already paid in."
                  : prepay === BigInt(0)
                    ? "Enter a number of rent periods."
                    : !token
                      ? "Loading your wallet balance…"
                      : token.allowance >= prepay
                        ? "Already approved. Now pay."
                        : null
              }
              onClick={() => send("Approve rent", { address: lease.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease.address, prepay] })}
            >
              Approve {formatUsdt(prepay)} USDT
            </ActionButton>
            <ActionButton
              busy={pending === "Prepay rent"}
              disabledReason={
                remainingToFund === 0
                  ? "The whole term is already paid in."
                  : prepay === BigInt(0)
                    ? "Enter a number of rent periods."
                  : n > remainingToFund
                    ? `Only ${count(remainingToFund)} left in the term.`
                    : !token || token.allowance < prepay
                      ? "Approve the amount first (button on the left)."
                      : token.balance < prepay
                        ? `Not enough USDT in your wallet (you have ${formatUsdt(token.balance)}).`
                        : null
              }
              onClick={() => send("Prepay rent", { address: lease.address, abi: rentalEscrowAbi, functionName: "payRent", args: [n] })}
            >
              Pay {count(n || 0)}
            </ActionButton>
          </div>
        </div>
      )}
    </Card>
  );
}
