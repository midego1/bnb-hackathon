"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { FilePicker } from "@/components/FilePicker";
import { ActionButton, Card, CopyButton, Notice } from "@/components/ui";
import { documentUrl, photosForHash, type EvidenceView } from "@/lib/demoEvidence";
import { EvidenceKind, LeaseStatus, rentalEscrowAbi } from "@/lib/contracts";
import { evidenceUrl, uploadEvidence } from "@/lib/evidence";
import { ZERO_HASH } from "@/lib/hash";
import type { LeaseData } from "@/lib/hooks/useLease";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";
import { useTx } from "@/lib/hooks/useTx";
import { evidenceFromEvents } from "./evidence";
import type { Viewer } from "./model";

/** Rental agreement + pickup / return photos: off-chain files, content hashes anchored on-chain. */
export function EvidencePanel({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const { checkIn, checkOut } = evidenceFromEvents(events);
  const isParty = viewer === "landlord" || viewer === "tenant";
  const open = lease.status !== LeaseStatus.Settled && lease.status !== LeaseStatus.Cancelled;
  const moveOutStage = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;

  return (
    <Card title="Documents & photos" aside={<span className="text-xs text-subtle">Files off-chain · fingerprints (SHA-256) on-chain</span>}>
      <div className="space-y-5 text-sm">
        <div>
          <p className="text-xs text-subtle">Rental agreement</p>
          {lease.terms.leaseHash === ZERO_HASH ? (
            <p className="text-subtle">No rental agreement attached.</p>
          ) : (
            <HashLink hash={lease.terms.leaseHash} label="lease.pdf" href={documentUrl(lease.terms.leaseHash)} />
          )}
        </div>
        <PhotoRow title="Pickup photos" hashes={checkIn} empty="None yet. The owner or renter can add them below; the AI inspection needs at least one." />
        <PhotoRow
          title="Return photos"
          hashes={checkOut}
          empty={moveOutStage ? "None yet. Add them at return so the AI inspection can compare." : "Added at return, once the rental is active."}
        />
        {isParty && open && (
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <AnchorPhotos lease={lease} kind="CheckIn" />
            {moveOutStage ? (
              <AnchorPhotos lease={lease} kind="CheckOut" />
            ) : (
              <p className="self-center text-xs text-subtle">Return photos can be added once the renter has funded the rental.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function PhotoRow({ title, hashes, empty }: { title: string; hashes: Hex[]; empty: string }) {
  const photos = hashes.flatMap(photosForHash);
  return (
    <div>
      <p className="text-xs text-subtle">
        {title} ({photos.length})
      </p>
      {photos.length === 0 ? (
        <p className="text-subtle">{empty}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid={`${title.toLowerCase().replace(/\W+/g, "-")}`}>
          {photos.map((p) => (
            <EvidenceThumb key={p.hash} photo={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Photo thumbnail with its on-chain hash on hover and a copy button; a hash tile when the file can't be loaded. */
export function EvidenceThumb({ photo }: { photo: EvidenceView }) {
  const [failed, setFailed] = useState(false);
  const short = `${photo.hash.slice(0, 10)}…${photo.hash.slice(-4)}`;
  return (
    <li className="group min-w-0" data-testid="evidence-thumb">
      <a href={photo.src} target="_blank" rel="noreferrer" title={`SHA-256 ${photo.hash}`} className="relative block aspect-[4/3] overflow-hidden rounded-lg border border-border bg-surface-muted">
        {failed ? (
          <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-subtle">
            <span>File not in storage</span>
            <span className="font-mono">{photo.hash.slice(2, 10)}</span>
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- content-addressed evidence (API) or bundled demo file
          <img src={photo.src} alt={photo.label ? `${photo.label} photo` : `Photo ${short}`} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-slate-950/70 px-2 py-1 font-mono text-[10px] text-white opacity-0 transition group-hover:opacity-100">
          {photo.hash}
        </span>
      </a>
      <p className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate capitalize text-muted">{photo.label ?? <span className="font-mono normal-case">{short}</span>}</span>
        <CopyButton value={photo.hash} label="Copy photo hash" />
      </p>
    </li>
  );
}

export function HashLink({ hash, label, href }: { hash: Hex; label?: string; href?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a href={href ?? evidenceUrl(hash)} target="_blank" rel="noreferrer" title={`SHA-256 ${hash}`} className="break-all font-mono text-xs underline decoration-dotted underline-offset-2">
        {label ? `${label} · ` : ""}
        {hash.slice(0, 18)}…{hash.slice(-6)}
      </a>
      <CopyButton value={hash} label="Copy hash" />
    </span>
  );
}

function AnchorPhotos({ lease, kind }: { lease: LeaseData; kind: "CheckIn" | "CheckOut" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const { send } = useTx();
  const label = kind === "CheckIn" ? "pickup" : "return";
  const testKey = kind === "CheckIn" ? "check-in" : "check-out"; // stable test ids, independent of the wording

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
      <FilePicker
        label={`Add ${label} photos`}
        accept="image/jpeg,image/png,image/webp"
        multiple
        files={files}
        onChange={setFiles}
        hint="JPEG, PNG or WebP, up to 10 MB each. Tap to choose."
        testId={`${testKey}-photos`}
      />
      {warning && <Notice kind="warn">{warning}</Notice>}
      <ActionButton variant="secondary" busy={!!busy} disabledReason={files.length === 0 ? `Choose one or more ${label} photos first.` : null} onClick={go} data-testid={`anchor-${testKey}`}>
        {busy ?? `Upload & record ${files.length || ""} photo${files.length === 1 ? "" : "s"} on-chain`}
      </ActionButton>
    </div>
  );
}
