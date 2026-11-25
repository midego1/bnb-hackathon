"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ActionButton, Card, Countdown, inputClass } from "@/components/ui";
import { LeaseStatus, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { formatDate, formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { nextDue, releasableMonths, type Viewer } from "./model";
import { Stat } from "./FundingPanel";

/** Rent schedule: release funded rent; tenant can prepay further months. */
export function RentPanel({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { address } = useAccount();
  const { send, pending } = useTx();
  const { data: token } = useTokenState(viewer === "tenant" ? address : undefined, lease.address);
  const [months, setMonths] = useState("1");

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
        ? "All rent for the term has been released."
        : fundedAhead === 0
          ? "No funded rent left in escrow. The tenant needs to prepay the next month."
          : due
            ? `Next month is funded but not due until ${formatDate(due)}.`
            : "Nothing to release.";

  return (
    <Card title="Rent">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Released to landlord">
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
          Release {releasable > 0 ? `${releasable} month${releasable > 1 ? "s" : ""}` : "rent"} to landlord
        </ActionButton>
        {viewer === "tenant" && releasable > 0 && lease.monthsDue < lease.monthsFunded && (
          <p className="text-xs text-slate-500 sm:col-span-2">As the tenant you may release prepaid rent early. Anyone can release rent once it is due.</p>
        )}
      </div>
      {canPrepay && (
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="mb-2 text-sm font-medium">Prepay rent</p>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr] sm:items-start">
            <input type="number" min={1} max={remainingToFund} className={inputClass} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months to prepay" />
            <ActionButton
              variant="secondary"
              busy={pending === "Approve rent"}
              disabledReason={remainingToFund === 0 ? "The whole term is already paid." : prepay === BigInt(0) ? "Enter a number of months." : token && token.allowance >= prepay ? "Already approved." : null}
              onClick={() => send("Approve rent", { address: lease.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease.address, prepay] })}
            >
              Approve {formatUsdt(prepay)} USDT
            </ActionButton>
            <ActionButton
              busy={pending === "Prepay rent"}
              disabledReason={
                remainingToFund === 0
                  ? "The whole term is already paid."
                  : n > remainingToFund
                    ? `Only ${remainingToFund} month(s) left in the term.`
                    : !token || token.allowance < prepay
                      ? "Approve the amount first."
                      : token.balance < prepay
                        ? "Not enough USDT in your wallet."
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
