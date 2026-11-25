"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ActionButton, Card, Countdown, inputClass, useMoney } from "@/components/ui";
import { LeaseStatus, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { formatDate, formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { nextDue, releasableMonths, type Viewer } from "./model";
import { Stat } from "./FundingPanel";

/** Rent schedule: release funded rent; renter can prepay further months. */
export function RentPanel({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { address } = useAccount();
  const { send, pending } = useTx();
  const { data: token } = useTokenState(viewer === "tenant" ? address : undefined, lease.address);
  const [months, setMonths] = useState("1");
  const money = useMoney();

  const releasable = releasableMonths(lease, viewer);
  const due = nextDue(lease);
  const fundedAhead = lease.monthsFunded - lease.monthsReleased;
  const remainingToFund = lease.terms.termMonths - lease.monthsFunded;
  const n = Number(months);
  const prepay = Number.isInteger(n) && n > 0 ? lease.terms.rentAmount * BigInt(n) : BigInt(0);
  const canPrepay = viewer === "tenant" && lease.status === LeaseStatus.Active;

  const releaseReason =
    releasable > 0
      ? null
      : lease.monthsReleased >= lease.terms.termMonths
        ? "All rent for the term has been paid out."
        : fundedAhead === 0
          ? "No paid-in rent left in escrow. The renter needs to prepay the next month first."
          : due
            ? `Next month is paid in but not due until ${formatDate(due)}.`
            : "Nothing to pay out yet.";

  return (
    <Card title="Rent" aside={<span className="text-xs text-subtle">{money(lease.terms.rentAmount)} / month</span>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Paid out to owner">
          <span className="font-semibold" data-testid="months-released">{lease.monthsReleased}</span> / {lease.terms.termMonths} months
        </Stat>
        <Stat label="Paid into escrow">
          <span className="font-semibold">{lease.monthsFunded}</span> / {lease.terms.termMonths} months
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
          Pay out {releasable > 0 ? `${releasable} month${releasable > 1 ? "s" : ""}` : "rent"} to owner
        </ActionButton>
        {viewer === "tenant" && releasable > 0 && lease.monthsDue < lease.monthsFunded && (
          <p className="text-xs text-subtle sm:col-span-2">As the renter you may pay out prepaid rent early. Once rent is due, anyone can trigger the payout.</p>
        )}
      </div>
      {canPrepay && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-sm font-medium">Prepay rent</p>
          <p className="mb-2 text-xs text-subtle">Paid into escrow now, paid out to the owner only as each month comes due. Two wallet steps: approve, then pay.</p>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr] sm:items-start">
            <input type="number" min={1} max={remainingToFund} className={inputClass} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months to prepay" />
            <ActionButton
              variant="secondary"
              busy={pending === "Approve rent"}
              disabledReason={
                remainingToFund === 0
                  ? "The whole term is already paid in."
                  : prepay === BigInt(0)
                    ? "Enter a number of months."
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
                    ? "Enter a number of months."
                  : n > remainingToFund
                    ? `Only ${remainingToFund} month(s) left in the term.`
                    : !token || token.allowance < prepay
                      ? "Approve the amount first (button on the left)."
                      : token.balance < prepay
                        ? `Not enough USDT in your wallet (you have ${formatUsdt(token.balance)}).`
                        : null
              }
              onClick={() => send("Prepay rent", { address: lease.address, abi: rentalEscrowAbi, functionName: "payRent", args: [n] })}
            >
              Pay {n || 0} month{n === 1 ? "" : "s"}
            </ActionButton>
          </div>
        </div>
      )}
    </Card>
  );
}
