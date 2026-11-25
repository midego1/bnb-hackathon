"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { ActionButton, Amount, Card, Countdown, Field, inputClass, Notice, PriceSourceBadge, useMoney } from "@/components/ui";
import { photosForHash } from "@/lib/demoEvidence";
import { prepareProposeSettlement } from "@/lib/actions/definitions";
import { fieldErrorIn } from "@/lib/actions/fields";
import { LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { responseWindow } from "@/lib/windows";
import { formatUsdt, parseUsdt } from "@/lib/format";
import { hashText } from "@/lib/hash";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { runInspection, type InspectionResult } from "@/lib/settlement";
import { dateTimeIn, utcDateTimeIn } from "./copy";
import { evidenceFromEvents } from "./evidence";
import { HashLink } from "./EvidencePanel";
import { roleName, viewerRole, type Viewer } from "./model";

/** Return: current proposal, accept / timeout, AI inspection, manual proposal, dispute. */
export function MoveOutPanel({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const isParty = viewer === "landlord" || viewer === "tenant";
  const canPropose = isParty && (lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut);
  const hasProposal = lease.status === LeaseStatus.MoveOut;
  const t = useT();

  if (!hasProposal && !canPropose) return null;
  // KE-02: once the reply window has closed (chain time), propose / accept / dispute all revert; only the timeout claim works.
  const window = responseWindow({ ...lease, responseWindowSeconds: lease.terms.responseWindow });
  // lib/windows.ts says it in English for the agent actions too; the same sentence in the visitor's language here.
  const reason = window.closed
    ? t("rental.move.windowClosed", { days: Math.round(lease.terms.responseWindow / 86400), date: utcDateTimeIn(t)(window.closesAt) })
    : null;

  return (
    <Card title={t.h("rental.move")} aside={<PriceSourceBadge />}>
      <div className="space-y-6">
        {window.closed && (
          <div data-testid="response-window-closed">
            <Notice kind="warn">{reason}</Notice>
          </div>
        )}
        {hasProposal && <CurrentProposal lease={lease} viewer={viewer} windowClosed={window.closed} windowReason={reason} />}
        {canPropose && !window.closed && <ProposeForms lease={lease} events={events} />}
        {canPropose && !window.closed && <DisputeButton lease={lease} />}
      </div>
    </Card>
  );
}

function CurrentProposal({ lease, viewer, windowClosed, windowReason }: { lease: LeaseData; viewer: Viewer; windowClosed: boolean; windowReason: string | null }) {
  const { send, pending } = useTx();
  const t = useT();
  const date = dateTimeIn(t);
  const tx = { accept: t("rental.move.acceptTx"), timeout: t("rental.move.timeoutTx") };
  const p = lease.proposal;
  const proposer = viewerRole(lease, p.proposer);
  const isCounterparty = (viewer === "landlord" || viewer === "tenant") && viewer !== proposer;
  const timeoutReached = windowClosed;

  return (
    <div className="rounded-xl border border-info-border bg-info-soft p-4" data-testid="current-proposal">
      <p className="text-sm font-medium">
        {t("rental.move.proposalBy", { n: p.nonce, role: roleName(proposer, t), date: date(p.proposedAt) })}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-subtle">{t("rental.move.backToRenter")}</p>
          <Amount value={p.tenantRefund} />
        </div>
        <div>
          <p className="text-xs text-subtle">{t("rental.move.ownerKeepsDamages")}</p>
          <Amount value={p.landlordClaim} />
        </div>
      </div>
      <p className="mt-3 text-xs text-subtle">
        {t("rental.move.fingerprint")}
        <HashLink hash={p.reportHash} />
      </p>
      {lease.timeoutAt > BigInt(0) && (
        <p className="mt-2 text-sm">
          {timeoutReached ? (
            <>{t("rental.move.ownerLate")}</>
          ) : (
            <>
              {t("rental.move.ownerHasUntil", { date: date(lease.timeoutAt) })}
              <Countdown target={lease.timeoutAt} clock={lease} />
              {t("rental.move.ownerHasUntilAfter")}
            </>
          )}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ActionButton
          variant={timeoutReached ? "secondary" : "primary"}
          busy={pending === tx.accept}
          disabledReason={
            windowClosed
              ? windowReason
              : isCounterparty
                ? null
                : proposer === viewer
                  ? t("rental.move.yourProposal")
                  : t("rental.move.onlyParties")
          }
          onClick={() => send(tx.accept, { address: lease.address, abi: rentalEscrowAbi, functionName: "accept", args: [p.nonce] })}
          data-testid="accept-proposal"
        >
          {t("rental.move.accept")}
        </ActionButton>
        {lease.timeoutAt > BigInt(0) && (
          <ActionButton
            variant={timeoutReached ? "primary" : "secondary"}
            className={timeoutReached ? "sm:order-first" : ""}
            busy={pending === tx.timeout}
            disabledReason={timeoutReached ? null : t("rental.move.availableAfter", { date: date(lease.timeoutAt) })}
            onClick={() => send(tx.timeout, { address: lease.address, abi: rentalEscrowAbi, functionName: "claimTimeout" })}
            data-testid="claim-timeout"
          >
            {timeoutReached ? t("rental.move.claim") : t("rental.move.returnAll")}
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function ProposeForms({ lease, events }: { lease: LeaseData; events: TimelineEvent[] | undefined }) {
  const { send, pending } = useTx();
  const t = useT();
  const tx = { ai: t("rental.move.submitAiTx"), manual: t("rental.move.proposeTx") };
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
    fieldErrorIn(t, prepareProposeSettlement.input, "toRenter", refund) ?? (refundAmount !== undefined && refundAmount > deposit ? t("rental.move.exceeds") : undefined);

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
        <h3 className="text-sm font-semibold">{t.h("rental.aiInspection")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(photoCount(checkOut) === 1 ? "rental.move.aiIntro.one" : "rental.move.aiIntro.other", { pickup: photoCount(checkIn), n: photoCount(checkOut) })}
        </p>
        <div className="mt-3 grid gap-3">
          <Field label={t("rental.move.notes")}>
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("rental.move.notesPlaceholder")} />
          </Field>
          <Field label={t("rental.move.scooterId")} hint={t("rental.move.scooterIdHint")}>
            <input className={inputClass} value={scooterId} onChange={(e) => setScooterId(e.target.value)} placeholder={t("rental.move.scooterIdPlaceholder")} data-testid="scooter-id" />
          </Field>
          <ActionButton
            variant="secondary"
            busy={inspecting}
            disabledReason={
              checkIn.length === 0
                ? t("rental.move.needPickup")
                : checkOut.length === 0
                  ? t("rental.move.needReturn")
                  : null
            }
            onClick={inspect}
            data-testid="run-inspection"
          >
            {inspecting ? t("rental.move.inspecting") : t("rental.move.runAi")}
          </ActionButton>
        </div>
        {aiError && <div className="mt-3"><Notice kind="error">{aiError}</Notice></div>}
        {report && (
          <div className="mt-4 rounded-xl border border-border p-4" data-testid="inspection-result">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t("rental.move.aiProposal")}</p>
              <span className="text-xs text-subtle">
                {t("rental.move.confidence", { pct: (report.confidence * 100).toFixed(0) })}
                {report.mock ? t("rental.move.demoInspector") : t("rental.move.visionModel", { provider: report.provider })}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-subtle">{t("rental.move.backToRenter")}</p>
                <Amount value={BigInt(report.tenantRefund)} />
              </div>
              <div>
                <p className="text-xs text-subtle">{t("rental.move.ownerKeeps")}</p>
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
              <p className="mt-3 text-xs text-subtle" data-testid="inspector-identity" title={t("rental.move.signer", { address: report.inspector.address })}>
                {t("rental.move.signedBy", { name: report.inspector.name })}
                {report.inspector.agentId !== undefined && t("rental.move.agentId", { id: String(report.inspector.agentId) })}
                {t("rental.move.signedAfter")}
              </p>
            )}
            <ActionButton
              className="mt-4"
              busy={pending === tx.ai}
              onClick={() => propose(tx.ai, BigInt(report.tenantRefund), report.reportHash)}
              data-testid="submit-ai-proposal"
            >
              {t("rental.move.submitAi")}
            </ActionButton>
            <p className="mt-2 text-xs text-subtle">{t("rental.move.afterSubmit")}</p>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">{t.h("rental.proposeYourself")}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("rental.move.refund")} error={refundError} hint={refundAmount !== undefined && !refundError ? t("rental.move.refundHint", { back: money(refundAmount), kept: money(deposit - refundAmount) }) : undefined}>
            <input name="tenantRefund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} />
          </Field>
          <Field label={t("rental.move.reason")}>
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rental.move.reasonPlaceholder")} />
          </Field>
        </div>
        <ActionButton
          className="mt-3"
          variant="secondary"
          busy={pending === tx.manual}
          disabledReason={refundError}
          onClick={() =>
            propose(tx.manual, refundAmount!, hashText(JSON.stringify({ tenantRefund: refundAmount!.toString(), reason })))
          }
          data-testid="propose-manual"
        >
          {t("rental.move.propose")}
        </ActionButton>
      </div>
    </div>
  );
}

function DisputeButton({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
  const [confirming, setConfirming] = useState(false);
  const t = useT();
  const label = t("rental.move.disputeTx");
  return (
    <div className="border-t border-border pt-5">
      <h3 className="text-sm font-semibold">{t.h("rental.cantAgree")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("rental.move.disputeBody", { days: lease.terms.arbiterWindow / 86400 })}</p>
      {confirming ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <ActionButton
            variant="danger"
            busy={pending === label}
            onClick={() => send(label, { address: lease.address, abi: rentalEscrowAbi, functionName: "dispute" }).then(() => setConfirming(false))}
            data-testid="confirm-dispute"
          >
            {t("rental.move.confirmDispute")}
          </ActionButton>
          <ActionButton variant="secondary" onClick={() => setConfirming(false)}>
            {t("rental.move.cancel")}
          </ActionButton>
        </div>
      ) : (
        <ActionButton className="mt-3" variant="danger" onClick={() => setConfirming(true)} data-testid="dispute">
          {t("rental.move.dispute")}
        </ActionButton>
      )}
    </div>
  );
}

/** What the inspector remembered about this scooter before judging (Living Brain or local stand-in). */
function MemoryNote({ memory, stored }: { memory: NonNullable<InspectionResult["memory"]>; stored?: boolean }) {
  const t = useT();
  return (
    <div className="mt-3 rounded-lg bg-muted p-3 text-xs" data-testid="inspection-memory">
      <p className="font-semibold">
        {t("rental.move.memory", { provider: memory.provider === "living-brain" ? "Living Brain" : t("rental.move.memoryLocal") })}
      </p>
      {memory.recalled.length ? (
        <>
          <p className="mt-1 text-muted-foreground">{t("rental.move.memoryRecalled", { id: memory.scooterId })}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {memory.recalled.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">{t("rental.move.memoryNone", { id: memory.scooterId })}</p>
      )}
      {memory.error && <p className="mt-1 text-danger">{t("rental.move.memoryFailed", { error: memory.error })}</p>}
      <p className="mt-1 text-subtle">{stored ? t("rental.move.memorySaved") : t("rental.move.memoryNotSaved")}</p>
    </div>
  );
}
