"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { FilePicker } from "@/components/FilePicker";
import { ActionButton, Amount, Card, Countdown, Field, inputClass, Notice, useMoney } from "@/components/ui";
import { prepareResolve } from "@/lib/actions/definitions";
import { fieldError } from "@/lib/actions/fields";
import { rentalEscrowAbi } from "@/lib/contracts";
import { uploadEvidence } from "@/lib/evidence";
import { formatUsdt, parseUsdt } from "@/lib/format";
import { hashText } from "@/lib/hash";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { dateTimeIn } from "./copy";
import { roleName, viewerRole } from "./model";

/** Arbiter: rule on the deposit split, backed by a hashed written ruling. */
export function ResolvePanel({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
  const t = useT();
  const label = t("rental.resolve.tx");
  const deposit = lease.terms.depositAmount;
  const p = lease.proposal;
  const [refund, setRefund] = useState(formatUsdt(p.nonce > 0 ? p.tenantRefund : deposit).replace(/,/g, ""));
  const [ruling, setRuling] = useState("");
  const [file, setFile] = useState<File[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseUsdt(refund);
  const money = useMoney();
  const deadlinePassed = lease.arbiterDeadline > BigInt(0) && lease.chainNow >= lease.arbiterDeadline;
  // Same rule and message as the prepare_resolve API / MCP tool (lib/actions).
  const error = fieldError(prepareResolve.input, "toRenter", refund) ?? (amount !== undefined && amount > deposit ? t("rental.move.exceeds") : undefined);

  async function resolve() {
    if (amount === undefined) return;
    setBusy(true);
    let rulingHash: Hex;
    if (file.length) {
      const up = await uploadEvidence(file);
      setWarning(up.warning ?? null);
      rulingHash = up.items[0].hash;
    } else {
      rulingHash = hashText(JSON.stringify({ tenantRefund: amount.toString(), ruling }));
    }
    await send(label, { address: lease.address, abi: rentalEscrowAbi, functionName: "resolve", args: [amount, rulingHash] });
    setBusy(false);
  }

  return (
    <Card
      title={t.h("rental.resolve")}
      aside={
        lease.arbiterDeadline > BigInt(0) && (
          <span className="text-xs text-subtle">
            {t("rental.resolve.deadline", { date: dateTimeIn(t)(lease.arbiterDeadline) })}
            <Countdown target={lease.arbiterDeadline} clock={lease} doneText={t("rental.resolve.passed")} />
          </span>
        )
      }
    >
      {p.nonce > 0 && (
        <div className="mb-4 text-sm text-muted-foreground">
          {t("rental.resolve.lastProposal", { role: roleName(viewerRole(lease, p.proposer), t), back: money(p.tenantRefund), kept: money(p.landlordClaim) })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("rental.resolve.refund")} error={error}>
          <input name="rulingRefund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-subtle">{t("rental.resolve.renterGets")}</p>
            <Amount value={amount !== undefined && !error ? amount : BigInt(0)} />
          </div>
          <div>
            <p className="text-xs text-subtle">{t("rental.resolve.ownerKeeps")}</p>
            <Amount value={amount !== undefined && !error ? deposit - amount : BigInt(0)} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("rental.resolve.ruling")} hint={t("rental.resolve.rulingHint")}>
            <textarea className={`${inputClass} min-h-24`} value={ruling} onChange={(e) => setRuling(e.target.value)} placeholder={t("rental.resolve.rulingPlaceholder")} />
          </Field>
        </div>
        <FilePicker label={t("rental.resolve.pdf")} accept="application/pdf" files={file} onChange={setFile} />
      </div>
      {warning && <div className="mt-3"><Notice kind="warn">{warning}</Notice></div>}
      <ActionButton
        className="mt-4"
        busy={busy || pending === label}
        disabledReason={
          deadlinePassed
            ? t("rental.resolve.deadlinePassed")
            : error ?? (!ruling.trim() && file.length === 0 ? t("rental.resolve.needReasons") : null)
        }
        onClick={resolve}
        data-testid="resolve"
      >
        {t("rental.resolve.button")}
      </ActionButton>
    </Card>
  );
}
