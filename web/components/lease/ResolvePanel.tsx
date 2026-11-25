"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { FilePicker } from "@/components/FilePicker";
import { ActionButton, Amount, Card, Countdown, Field, inputClass, Notice, useMoney } from "@/components/ui";
import { rentalEscrowAbi } from "@/lib/contracts";
import { uploadEvidence } from "@/lib/evidence";
import { formatDate, formatUsdt, parseUsdt } from "@/lib/format";
import { hashText } from "@/lib/hash";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTx } from "@/lib/hooks/useTx";
import { roleName, viewerRole } from "./model";

/** Arbiter: rule on the deposit split, backed by a hashed written ruling. */
export function ResolvePanel({ lease }: { lease: LeaseData }) {
  const { send, pending } = useTx();
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
  const error = amount === undefined ? "Enter an amount." : amount > deposit ? "Cannot exceed the deposit." : undefined;

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
    await send("Resolve dispute", { address: lease.address, abi: rentalEscrowAbi, functionName: "resolve", args: [amount, rulingHash] });
    setBusy(false);
  }

  return (
    <Card
      title="Rule on this dispute"
      aside={
        lease.arbiterDeadline > BigInt(0) && (
          <span className="text-xs text-slate-500">
            Deadline {formatDate(lease.arbiterDeadline)} · <Countdown target={lease.arbiterDeadline} clock={lease} doneText="passed" />
          </span>
        )
      }
    >
      {p.nonce > 0 && (
        <div className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Last proposal, by the {roleName(viewerRole(lease, p.proposer))}: tenant gets {money(p.tenantRefund)}, landlord keeps {money(p.landlordClaim)}.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deposit back to tenant (USDT)" error={error}>
          <input name="rulingRefund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-500">Tenant gets</p>
            <Amount value={amount !== undefined && !error ? amount : BigInt(0)} />
          </div>
          <div>
            <p className="text-xs text-slate-500">Landlord keeps</p>
            <Amount value={amount !== undefined && !error ? deposit - amount : BigInt(0)} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label="Written ruling" hint="Its fingerprint (hash) is stored on-chain with the payout, so the ruling can't be changed later.">
            <textarea className={`${inputClass} min-h-24`} value={ruling} onChange={(e) => setRuling(e.target.value)} placeholder="Reasons for the split…" />
          </Field>
        </div>
        <FilePicker label="…or attach the ruling as PDF" accept="application/pdf" files={file} onChange={setFile} />
      </div>
      {warning && <div className="mt-3"><Notice kind="warn">{warning}</Notice></div>}
      <ActionButton
        className="mt-4"
        busy={busy || pending === "Resolve dispute"}
        disabledReason={
          deadlinePassed
            ? "Your deadline has passed. The full deposit now goes back to the tenant via \"Return full deposit to tenant\"."
            : error ?? (!ruling.trim() && file.length === 0 ? "Write the reasons for your ruling, or attach it as a PDF." : null)
        }
        onClick={resolve}
        data-testid="resolve"
      >
        Settle with this split
      </ActionButton>
    </Card>
  );
}
