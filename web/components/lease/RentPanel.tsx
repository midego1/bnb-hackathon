"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ActionButton, Card, Countdown, inputClass, useMoney } from "@/components/ui";
import { LeaseStatus, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { formatUsdt } from "@/lib/format";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { countIn, perIn } from "@/lib/rentals";
import { dateTimeIn } from "./copy";
import { nextDue, releasablePeriods, type Viewer } from "./model";
import { Stat } from "./FundingPanel";

/** Rent schedule: release funded rent; renter can prepay further months. */
export function RentPanel({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { address } = useAccount();
  const { send, pending } = useTx();
  const { data: token } = useTokenState(viewer === "tenant" ? address : undefined, lease.address);
  const [months, setMonths] = useState("1");
  const money = useMoney();
  const t = useT();
  const per = perIn(t, lease.terms.rentPeriod);
  const count = (k: number) => countIn(t, k, lease.terms.rentPeriod);
  const date = dateTimeIn(t);
  const tx = { release: t("rental.rent.releaseTx"), approve: t("rental.rent.approveTx"), prepay: t("rental.rent.prepayTx") };

  const releasable = releasablePeriods(lease, viewer);
  const due = nextDue(lease);
  const fundedAhead = lease.periodsFunded - lease.periodsReleased;
  const remainingToFund = lease.terms.termPeriods - lease.periodsFunded;
  const n = Number(months);
  const prepay = Number.isInteger(n) && n > 0 ? lease.terms.rentAmount * BigInt(n) : BigInt(0);
  const canPrepay = viewer === "tenant" && lease.status === LeaseStatus.Active;

  const releaseReason =
    releasable > 0
      ? null
      : lease.periodsReleased >= lease.terms.termPeriods
        ? t("rental.rent.allOut")
        : fundedAhead === 0
          ? t("rental.rent.noneInEscrow", { per })
          : due
            ? t("rental.rent.notDue", { date: date(due), per })
            : t("rental.rent.nothingYet");

  return (
    <Card title={t.h("rental.rent")} aside={<span className="text-xs text-subtle">{t("rental.rent.perPeriod", { amount: money(lease.terms.rentAmount), per })}</span>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={t("rental.rent.paidOut")}>
          <span className="font-semibold" data-testid="months-released">{lease.periodsReleased}</span>
          {t("rental.rent.ofPeriods", { n: lease.terms.termPeriods })}
        </Stat>
        <Stat label={t("rental.rent.paidIn")}>
          <span className="font-semibold">{lease.periodsFunded}</span>
          {t("rental.rent.ofPeriods", { n: lease.terms.termPeriods })}
        </Stat>
        <Stat label={t("rental.rent.nextDue")}>
          {due ? (
            <span className="text-sm">
              {date(due)} · <Countdown target={due} clock={lease} doneText={t("rental.rent.dueNow")} />
            </span>
          ) : (
            <span className="text-sm">—</span>
          )}
        </Stat>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionButton
          busy={pending === tx.release}
          disabledReason={releaseReason}
          onClick={() => send(tx.release, { address: lease.address, abi: rentalEscrowAbi, functionName: "releaseRent" })}
          data-testid="release-rent"
        >
          {releasable > 0 ? t("rental.rent.release", { count: count(releasable) }) : t("rental.rent.releaseRent")}
        </ActionButton>
        {viewer === "tenant" && releasable > 0 && lease.periodsDue < lease.periodsFunded && (
          <p className="text-xs text-subtle sm:col-span-2">{t("rental.rent.early")}</p>
        )}
      </div>
      {canPrepay && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-sm font-medium">{t("rental.rent.prepay")}</p>
          <p className="mb-2 text-xs text-subtle">{t("rental.rent.prepayHint")}</p>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr] sm:items-start">
            <input type="number" min={1} max={remainingToFund} className={inputClass} value={months} onChange={(e) => setMonths(e.target.value)} aria-label={t("rental.rent.periodsInput")} />
            <ActionButton
              variant="secondary"
              busy={pending === tx.approve}
              disabledReason={
                remainingToFund === 0
                  ? t("rental.rent.wholeTerm")
                  : prepay === BigInt(0)
                    ? t("rental.rent.enterPeriods")
                    : !token
                      ? t("rental.rent.loadingBalance")
                      : token.allowance >= prepay
                        ? t("rental.rent.approved")
                        : null
              }
              onClick={() => send(tx.approve, { address: lease.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease.address, prepay] })}
            >
              {t("rental.rent.approve", { amount: formatUsdt(prepay) })}
            </ActionButton>
            <ActionButton
              busy={pending === tx.prepay}
              disabledReason={
                remainingToFund === 0
                  ? t("rental.rent.wholeTerm")
                  : prepay === BigInt(0)
                    ? t("rental.rent.enterPeriods")
                  : n > remainingToFund
                    ? t("rental.rent.onlyLeft", { count: count(remainingToFund) })
                    : !token || token.allowance < prepay
                      ? t("rental.rent.approveFirst")
                      : token.balance < prepay
                        ? t("rental.rent.notEnough", { balance: formatUsdt(token.balance) })
                        : null
              }
              onClick={() => send(tx.prepay, { address: lease.address, abi: rentalEscrowAbi, functionName: "payRent", args: [n] })}
            >
              {t("rental.rent.pay", { count: count(n || 0) })}
            </ActionButton>
          </div>
        </div>
      )}
    </Card>
  );
}
