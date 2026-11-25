"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { FilePicker } from "@/components/FilePicker";
import { ActionButton, Card, Notice } from "@/components/ui";
import { EvidenceKind, LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { evidenceUrl, uploadEvidence } from "@/lib/evidence";
import { ZERO_HASH } from "@/lib/hash";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { evidenceFromEvents } from "./evidence";
import type { Viewer } from "./model";

/** Lease document + check-in / check-out photos: off-chain files, content hashes anchored on-chain. */
export function EvidencePanel({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const { checkIn, checkOut } = evidenceFromEvents(events);
  const isParty = viewer === "landlord" || viewer === "tenant";
  const open = lease.status !== LeaseStatus.Settled && lease.status !== LeaseStatus.Cancelled;
  const moveOutStage = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;

  return (
    <Card title="Documents & photos">
      <div className="space-y-4 text-sm">
        <div>
          <p className="text-xs text-slate-500">Lease contract</p>
          {lease.terms.leaseHash === ZERO_HASH ? <p>No document attached.</p> : <HashLink hash={lease.terms.leaseHash} label="lease.pdf" />}
        </div>
        <PhotoRow title="Check-in photos" hashes={checkIn} />
        <PhotoRow title="Check-out photos" hashes={checkOut} />
        {isParty && open && (
          <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 dark:border-slate-800">
            <AnchorPhotos lease={lease} kind="CheckIn" />
            {moveOutStage && <AnchorPhotos lease={lease} kind="CheckOut" />}
          </div>
        )}
      </div>
    </Card>
  );
}

function PhotoRow({ title, hashes }: { title: string; hashes: Hex[] }) {
  return (
    <div>
      <p className="text-xs text-slate-500">
        {title} ({hashes.length})
      </p>
      {hashes.length === 0 ? (
        <p className="text-slate-500">None yet.</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2">
          {hashes.map((h) => (
            <EvidenceThumb key={h} hash={h} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Thumbnail of a stored photo; falls back to a hash tile when the file is not in evidence storage. */
function EvidenceThumb({ hash }: { hash: Hex }) {
  const [failed, setFailed] = useState(false);
  const tile = "h-16 w-16 rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800";
  return (
    <a href={evidenceUrl(hash)} target="_blank" rel="noreferrer" title={hash} className="block">
      {failed ? (
        <span className={`${tile} flex flex-col items-center justify-center p-1 text-center font-mono text-[10px] text-slate-500`}>
          <span aria-hidden>#</span>
          {hash.slice(2, 8)}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- content-addressed evidence served by our API
        <img src={evidenceUrl(hash)} alt={`Evidence ${hash.slice(0, 10)}`} onError={() => setFailed(true)} className={`${tile} object-cover`} />
      )}
    </a>
  );
}

export function HashLink({ hash, label }: { hash: Hex; label?: string }) {
  return (
    <a href={evidenceUrl(hash)} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline decoration-dotted underline-offset-2">
      {label ? `${label} · ` : ""}
      {hash.slice(0, 18)}…{hash.slice(-6)}
    </a>
  );
}

function AnchorPhotos({ lease, kind }: { lease: LeaseData; kind: "CheckIn" | "CheckOut" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const { send } = useTx();
  const label = kind === "CheckIn" ? "check-in" : "check-out";

  async function go() {
    setBusy("Uploading…");
    const { items, warning } = await uploadEvidence(files);
    setWarning(warning ?? null);
    for (const [i, item] of items.entries()) {
      setBusy(`Anchoring ${i + 1} of ${items.length}…`);
      const ok = await send(`Anchor ${label} photo ${i + 1}/${items.length}`, {
        address: lease.address,
        abi: rentalEscrowAbi,
        functionName: "addEvidence",
        args: [EvidenceKind[kind], item.hash],
      });
      if (!ok) break;
    }
    setFiles([]);
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <FilePicker label={`Add ${label} photos`} accept="image/jpeg,image/png,image/webp" multiple files={files} onChange={setFiles} testId={`${label}-photos`} />
      {warning && <Notice kind="warn">{warning}</Notice>}
      <ActionButton variant="secondary" busy={!!busy} disabledReason={files.length === 0 ? "Choose one or more photos." : null} onClick={go} data-testid={`anchor-${label}`}>
        {busy ?? `Upload & anchor ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}
      </ActionButton>
    </div>
  );
}
