"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { ActionButton, Amount, Card, Countdown, Field, inputClass, Notice, PriceSourceBadge, useMoney } from "@/components/ui";
import { photosForHash } from "@/lib/demoEvidence";
import { LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { formatDate, formatUsdt, parseUsdt } from "@/lib/format";
import { hashText } from "@/lib/hash";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { runInspection, type InspectionResult } from "@/lib/settlement";
import { evidenceFromEvents } from "./evidence";
import { HashLink } from "./EvidencePanel";
import { roleName, viewerRole, type Viewer } from "./model";

/** Move-out: current proposal, accept / timeout, AI inspection, manual proposal, dispute. */
export function MoveOutPanel({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const isParty = viewer === "landlord" || viewer === "tenant";
  const canPropose = isParty && (lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut);
  const hasProposal = lease.status === LeaseStatus.MoveOut;

  if (!hasProposal && !canPropose) return null;

  return (
    <Card title="Move-out & deposit" aside={<PriceSourceBadge />}>
      <div className="space-y-6">
        {hasProposal && <CurrentProposal lease={lease} viewer={viewer} />}
        {canPropose && <ProposeForms lease={lease} events={events} />}
        {canPropose && <DisputeButton lease={lease} />}
      </div>
    </Card>
  );
}

function CurrentProposal({ lease, viewer }: { lease: LeaseData; viewer: Viewer }) {
  const { send, pending } = useTx();
  const p = lease.proposal;
  const proposer = viewerRole(lease, p.proposer);
  const isCounterparty = (viewer === "landlord" || viewer === "tenant") && viewer !== proposer;
  const timeoutReached = lease.timeoutAt > BigInt(0) && lease.chainNow >= lease.timeoutAt;

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/40" data-testid="current-proposal">
      <p className="text-sm font-medium">
        Proposal #{p.nonce} by the {roleName(proposer)} · {formatDate(p.proposedAt)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Back to tenant</p>
          <Amount value={p.tenantRefund} />
        </div>
        <div>
          <p className="text-xs text-slate-500">Landlord keeps (damages)</p>
          <Amount value={p.landlordClaim} />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Inspection report fingerprint: <HashLink hash={p.reportHash} />
      </p>
      {lease.timeoutAt > BigInt(0) && (
        <p className="mt-2 text-sm">
          {timeoutReached ? (
            <>The landlord did not answer in time. Anyone can now close the lease and return the full deposit to the tenant.</>
          ) : (
            <>
              The landlord has until {formatDate(lease.timeoutAt)} (<Countdown target={lease.timeoutAt} clock={lease} />) to accept, counter
              or open a dispute. After that, the full deposit goes back to the tenant.
            </>
          )}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ActionButton
          busy={pending === "Accept proposal"}
          disabledReason={
            isCounterparty ? null : proposer === viewer ? "You made this proposal, so the other side has to accept it." : "Only the landlord or the tenant can accept a proposal."
          }
          onClick={() => send("Accept proposal", { address: lease.address, abi: rentalEscrowAbi, functionName: "accept", args: [p.nonce] })}
          data-testid="accept-proposal"
        >
          Accept & settle now
        </ActionButton>
        {lease.timeoutAt > BigInt(0) && (
          <ActionButton
            variant="secondary"
            busy={pending === "Claim landlord timeout"}
            disabledReason={timeoutReached ? null : `Available after ${formatDate(lease.timeoutAt)}, if the landlord has not answered.`}
            onClick={() => send("Claim landlord timeout", { address: lease.address, abi: rentalEscrowAbi, functionName: "claimTimeout" })}
            data-testid="claim-timeout"
          >
            Return full deposit to tenant
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function ProposeForms({ lease, events }: { lease: LeaseData; events: TimelineEvent[] | undefined }) {
  const { send, pending } = useTx();
  const { checkIn, checkOut } = evidenceFromEvents(events);
  const money = useMoney();
  const photoCount = (hashes: Hex[]) => hashes.flatMap(photosForHash).length;
  const [inspecting, setInspecting] = useState(false);
  const [report, setReport] = useState<InspectionResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [refund, setRefund] = useState(formatUsdt(lease.terms.depositAmount).replace(/,/g, ""));
  const [reason, setReason] = useState("");
  const deposit = lease.terms.depositAmount;
  const refundAmount = parseUsdt(refund);
  const refundError = refundAmount === undefined ? "Enter an amount." : refundAmount > deposit ? "Cannot exceed the deposit." : undefined;

  async function inspect() {
    setInspecting(true);
    setAiError(null);
    try {
      setReport(await runInspection({ deposit, checkIn, checkOut, notes: notes || undefined }));
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setInspecting(false);
    }
  }

  const propose = (label: string, tenantRefund: bigint, reportHash: Hex) =>
    send(label, { address: lease.address, abi: rentalEscrowAbi, functionName: "propose", args: [tenantRefund, reportHash] });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">AI move-out inspection</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Compares the {photoCount(checkIn)} check-in and {photoCount(checkOut)} check-out photo{photoCount(checkOut) === 1 ? "" : "s"} recorded on this
          lease and suggests how to split the deposit. Nothing is sent on-chain until you choose to propose it.
        </p>
        <div className="mt-3 grid gap-3">
          <Field label="Notes for the inspector (optional)">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. hinge was already loose at check-in" />
          </Field>
          <ActionButton
            variant="secondary"
            busy={inspecting}
            disabledReason={
              checkIn.length === 0
                ? "Needs at least one check-in photo. Add one under Documents & photos."
                : checkOut.length === 0
                  ? "Needs at least one check-out photo. Add them under Documents & photos."
                  : null
            }
            onClick={inspect}
            data-testid="run-inspection"
          >
            {inspecting ? "Inspecting photos…" : "Run AI inspection"}
          </ActionButton>
        </div>
        {aiError && <div className="mt-3"><Notice kind="error">{aiError}</Notice></div>}
        {report && (
          <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700" data-testid="inspection-result">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">AI inspection proposal</p>
              <span className="text-xs text-slate-500">
                confidence {(report.confidence * 100).toFixed(0)}% · {report.mock ? "demo inspector (no AI key configured)" : `vision model: ${report.provider}`}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500">Back to tenant</p>
                <Amount value={BigInt(report.tenantRefund)} />
              </div>
              <div>
                <p className="text-xs text-slate-500">Landlord keeps</p>
                <Amount value={BigInt(report.landlordClaim)} />
              </div>
            </div>
            {report.reasons.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {report.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {report.inspector && (
              <p className="mt-3 text-xs text-slate-500" data-testid="inspector-identity" title={`Signer ${report.inspector.address}`}>
                Signed by {report.inspector.name}
                {report.inspector.agentId !== undefined && <>, ERC-8004 agent #{report.inspector.agentId}</>}. Its identity is
                registered on BNB Chain, so anyone can check this proposal came from it.
              </p>
            )}
            <ActionButton
              className="mt-4"
              busy={pending === "Submit AI proposal"}
              onClick={() => propose("Submit AI proposal", BigInt(report.tenantRefund), report.reportHash)}
              data-testid="submit-ai-proposal"
            >
              Propose this split on-chain
            </ActionButton>
            <p className="mt-2 text-xs text-slate-500">The other side then accepts (paid out at once), counters, or opens a dispute.</p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="text-sm font-semibold">Propose a split yourself</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Deposit back to tenant (USDT)" error={refundError} hint={refundAmount !== undefined && !refundError ? <>Tenant gets {money(refundAmount)}, landlord keeps {money(deposit - refundAmount)}</> : undefined}>
            <input name="tenantRefund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} />
          </Field>
          <Field label="Reason (its fingerprint is stored on-chain)">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. full refund, flat in good order" />
          </Field>
        </div>
        <ActionButton
          className="mt-3"
          variant="secondary"
          busy={pending === "Propose split"}
          disabledReason={refundError}
          onClick={() =>
            propose("Propose split", refundAmount!, hashText(JSON.stringify({ tenantRefund: refundAmount!.toString(), reason })))
          }
          data-testid="propose-manual"
        >
          Propose split
        </ActionButton>
      </div>
    </div>
  );
}

function DisputeButton({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
      <h3 className="text-sm font-semibold">Can&apos;t agree?</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Hand the deposit decision to the dispute desk ({lease.terms.arbiterWindow / 86400} days to rule, or the full deposit goes back to the
        tenant). Rent keeps being paid out as scheduled.
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <ActionButton
            variant="danger"
            busy={pending === "Open dispute"}
            onClick={() => send("Open dispute", { address: lease.address, abi: rentalEscrowAbi, functionName: "dispute" }).then(() => setConfirming(false))}
            data-testid="confirm-dispute"
          >
            Yes, open a dispute
          </ActionButton>
          <ActionButton variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </ActionButton>
        </div>
      ) : (
        <ActionButton className="mt-3" variant="danger" onClick={() => setConfirming(true)} data-testid="dispute">
          Open a dispute
        </ActionButton>
      )}
    </div>
  );
}
