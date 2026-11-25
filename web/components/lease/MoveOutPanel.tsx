"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { ActionButton, Amount, Card, Countdown, Field, inputClass, Notice, PriceSourceBadge, useMoney } from "@/components/ui";
import { photosForHash } from "@/lib/demoEvidence";
import { prepareProposeSettlement } from "@/lib/actions/definitions";
import { fieldError } from "@/lib/actions/fields";
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

/** Return: current proposal, accept / timeout, AI inspection, manual proposal, dispute. */
export function MoveOutPanel({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const isParty = viewer === "landlord" || viewer === "tenant";
  const canPropose = isParty && (lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut);
  const hasProposal = lease.status === LeaseStatus.MoveOut;

  if (!hasProposal && !canPropose) return null;

  return (
    <Card title="Return & deposit" aside={<PriceSourceBadge />}>
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
    <div className="rounded-xl border border-info-border bg-info-soft p-4" data-testid="current-proposal">
      <p className="text-sm font-medium">
        Proposal #{p.nonce} by the {roleName(proposer)} · {formatDate(p.proposedAt)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-subtle">Back to renter</p>
          <Amount value={p.tenantRefund} />
        </div>
        <div>
          <p className="text-xs text-subtle">Owner keeps (damages)</p>
          <Amount value={p.landlordClaim} />
        </div>
      </div>
      <p className="mt-3 text-xs text-subtle">
        Inspection report fingerprint: <HashLink hash={p.reportHash} />
      </p>
      {lease.timeoutAt > BigInt(0) && (
        <p className="mt-2 text-sm">
          {timeoutReached ? (
            <>The owner did not answer in time. Anyone can now close the rental and return the full deposit to the renter.</>
          ) : (
            <>
              The owner has until {formatDate(lease.timeoutAt)} (<Countdown target={lease.timeoutAt} clock={lease} />) to accept, counter
              or open a dispute. After that, the full deposit goes back to the renter.
            </>
          )}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ActionButton
          busy={pending === "Accept proposal"}
          disabledReason={
            isCounterparty ? null : proposer === viewer ? "You made this proposal, so the other side has to accept it." : "Only the owner or the renter can accept a proposal."
          }
          onClick={() => send("Accept proposal", { address: lease.address, abi: rentalEscrowAbi, functionName: "accept", args: [p.nonce] })}
          data-testid="accept-proposal"
        >
          Accept & settle now
        </ActionButton>
        {lease.timeoutAt > BigInt(0) && (
          <ActionButton
            variant="secondary"
            busy={pending === "Claim owner timeout"}
            disabledReason={timeoutReached ? null : `Available after ${formatDate(lease.timeoutAt)}, if the owner has not answered.`}
            onClick={() => send("Claim owner timeout", { address: lease.address, abi: rentalEscrowAbi, functionName: "claimTimeout" })}
            data-testid="claim-timeout"
          >
            Return full deposit to renter
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
  const [scooterId, setScooterId] = useState("");
  const [refund, setRefund] = useState(formatUsdt(lease.terms.depositAmount).replace(/,/g, ""));
  const [reason, setReason] = useState("");
  const deposit = lease.terms.depositAmount;
  const refundAmount = parseUsdt(refund);
  // Same rule and message as the prepare_propose_settlement API / MCP tool (lib/actions).
  const refundError =
    fieldError(prepareProposeSettlement.input, "toRenter", refund) ?? (refundAmount !== undefined && refundAmount > deposit ? "Cannot exceed the deposit." : undefined);

  async function inspect() {
    setInspecting(true);
    setAiError(null);
    try {
      setReport(await runInspection({ deposit, checkIn, checkOut, notes: notes || undefined, scooterId: scooterId.trim() || lease.address }));
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
        <h3 className="text-sm font-semibold">AI return inspection</h3>
        <p className="mt-1 text-sm text-muted">
          Compares the {photoCount(checkIn)} pickup and {photoCount(checkOut)} return photo{photoCount(checkOut) === 1 ? "" : "s"} recorded on this
          rental and suggests how to split the deposit. Nothing is sent on-chain until you choose to propose it.
        </p>
        <div className="mt-3 grid gap-3">
          <Field label="Notes for the inspector (optional)">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. left mirror was already scratched at pickup" />
          </Field>
          <Field label="Scooter plate or id (optional)" hint="Keys the inspector's memory of this scooter across rentals. Defaults to this rental's address.">
            <input className={inputClass} value={scooterId} onChange={(e) => setScooterId(e.target.value)} placeholder="e.g. 1กข 1234 Bangkok" data-testid="scooter-id" />
          </Field>
          <ActionButton
            variant="secondary"
            busy={inspecting}
            disabledReason={
              checkIn.length === 0
                ? "Needs at least one pickup photo. Add one under Documents & photos."
                : checkOut.length === 0
                  ? "Needs at least one return photo. Add them under Documents & photos."
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
          <div className="mt-4 rounded-xl border border-border p-4" data-testid="inspection-result">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">AI inspection proposal</p>
              <span className="text-xs text-subtle">
                confidence {(report.confidence * 100).toFixed(0)}% · {report.mock ? "demo inspector (no AI key configured)" : `vision model: ${report.provider}`}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-subtle">Back to renter</p>
                <Amount value={BigInt(report.tenantRefund)} />
              </div>
              <div>
                <p className="text-xs text-subtle">Owner keeps</p>
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
            {report.memory && <MemoryNote memory={report.memory} stored={report.memoryStored} />}
            {report.inspector && (
              <p className="mt-3 text-xs text-subtle" data-testid="inspector-identity" title={`Signer ${report.inspector.address}`}>
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
            <p className="mt-2 text-xs text-subtle">The other side then accepts (paid out at once), counters, or opens a dispute.</p>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Propose a split yourself</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Deposit back to renter (USDT)" error={refundError} hint={refundAmount !== undefined && !refundError ? <>Renter gets {money(refundAmount)}, owner keeps {money(deposit - refundAmount)}</> : undefined}>
            <input name="tenantRefund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} />
          </Field>
          <Field label="Reason (its fingerprint is stored on-chain)">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. full refund, scooter returned in good order" />
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
    <div className="border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Can&apos;t agree?</h3>
      <p className="mt-1 text-sm text-muted">
        Hand the deposit decision to the dispute desk ({lease.terms.arbiterWindow / 86400} days to rule, or the full deposit goes back to the
        renter). Rent keeps being paid out as scheduled.
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

/** What the inspector remembered about this scooter before judging (Living Brain or local stand-in). */
function MemoryNote({ memory, stored }: { memory: NonNullable<InspectionResult["memory"]>; stored?: boolean }) {
  return (
    <div className="mt-3 rounded-lg bg-surface-muted p-3 text-xs" data-testid="inspection-memory">
      <p className="font-semibold">
        Scooter memory · {memory.provider === "living-brain" ? "Living Brain" : "local (Living Brain not configured)"}
      </p>
      {memory.recalled.length ? (
        <>
          <p className="mt-1 text-muted">Earlier inspections of {memory.scooterId}. Damage listed here is pre-existing and is not charged again:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
            {memory.recalled.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-muted">No earlier inspections of {memory.scooterId} on record.</p>
      )}
      {memory.error && <p className="mt-1 text-danger">Memory lookup failed: {memory.error}</p>}
      <p className="mt-1 text-subtle">{stored ? "This inspection was saved to the scooter's memory." : "This inspection was not saved to memory."}</p>
    </div>
  );
}
