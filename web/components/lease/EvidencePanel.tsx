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
import { useT } from "@/lib/i18n/client";
import type { Key } from "@/lib/i18n/t";
import { evidenceFromEvents } from "./evidence";
import type { Viewer } from "./model";

/** Rental agreement + pickup / return photos: off-chain files, content hashes anchored on-chain. */
export function EvidencePanel({ lease, viewer, events }: { lease: LeaseData; viewer: Viewer; events: TimelineEvent[] | undefined }) {
  const { checkIn, checkOut } = evidenceFromEvents(events);
  const isParty = viewer === "landlord" || viewer === "tenant";
  const moveOutStage = lease.status === LeaseStatus.Active || lease.status === LeaseStatus.MoveOut || lease.status === LeaseStatus.Disputed;
  const addPickup = lease.status === LeaseStatus.Created || (lease.status === LeaseStatus.Active && checkOut.length === 0);
  const t = useT();

  return (
    <Card title={t.h("rental.evidence")} aside={<span className="text-xs text-subtle">{t("rental.evidence.aside")}</span>}>
      <div className="space-y-5 text-sm">
        <div>
          <p className="text-xs text-subtle">{t("rental.evidence.agreement")}</p>
          {lease.terms.leaseHash === ZERO_HASH ? (
            <p className="text-subtle">{t("rental.evidence.noAgreement")}</p>
          ) : (
            <HashLink hash={lease.terms.leaseHash} label="lease.pdf" href={documentUrl(lease.terms.leaseHash)} />
          )}
        </div>
        <PhotoRow title={t("rental.evidence.pickup")} testId="pickup-photos" hashes={checkIn} empty={t("rental.evidence.pickupEmpty")} />
        <PhotoRow
          title={t("rental.evidence.return")}
          testId="return-photos"
          hashes={checkOut}
          empty={moveOutStage ? t("rental.evidence.returnEmpty") : t("rental.evidence.returnLater")}
        />
        {/* Only what this viewer can add now: pickup photos until the return starts, return photos once the rental runs. */}
        {isParty && (addPickup || moveOutStage) && (
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            {addPickup && <AnchorPhotos lease={lease} kind="CheckIn" />}
            {moveOutStage && <AnchorPhotos lease={lease} kind="CheckOut" />}
          </div>
        )}
      </div>
    </Card>
  );
}

function PhotoRow({ title, testId, hashes, empty }: { title: string; testId: string; hashes: Hex[]; empty: string }) {
  const photos = hashes.flatMap(photosForHash);
  const t = useT();
  return (
    <div>
      <p className="text-xs text-subtle">{t("rental.evidence.count", { title, n: photos.length })}</p>
      {photos.length === 0 ? (
        <p className="text-subtle">{empty}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid={testId}>
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
  const t = useT();
  const short = `${photo.hash.slice(0, 10)}…${photo.hash.slice(-4)}`;
  // Demo photos are labelled from their file names ("left side"); anything without a translation keeps its label.
  const angleKey = `rental.evidence.angle.${photo.label}` as Key;
  const label = photo.label && (t(angleKey) === angleKey ? photo.label : t(angleKey));
  return (
    <li className="group min-w-0" data-testid="evidence-thumb">
      <a href={photo.src} target="_blank" rel="noreferrer" title={`SHA-256 ${photo.hash}`} className="relative block aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted">
        {failed ? (
          <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-subtle">
            <span>{t("rental.evidence.notInStorage")}</span>
            <span className="font-mono">{photo.hash.slice(2, 10)}</span>
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- content-addressed evidence (API) or bundled demo file
          <img src={photo.src} alt={label ? t("rental.evidence.photoAlt", { label }) : t("rental.evidence.photoAltHash", { short })} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-overlay/70 px-2 py-1 font-mono text-[10px] text-overlay-foreground opacity-0 transition group-hover:opacity-100">
          {photo.hash}
        </span>
      </a>
      <p className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate capitalize text-muted-foreground">{label || <span className="font-mono normal-case">{short}</span>}</span>
        <CopyButton value={photo.hash} label={t("rental.evidence.copyPhotoHash")} />
      </p>
    </li>
  );
}

export function HashLink({ hash, label, href }: { hash: Hex; label?: string; href?: string }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a href={href ?? evidenceUrl(hash)} target="_blank" rel="noreferrer" title={`SHA-256 ${hash}`} className="inline-flex items-center break-all font-mono text-xs underline decoration-dotted underline-offset-2">
        {label ? `${label} · ` : ""}
        {hash.slice(0, 18)}…{hash.slice(-6)}
      </a>
      <CopyButton value={hash} label={t("rental.evidence.copyHash")} />
    </span>
  );
}

function AnchorPhotos({ lease, kind }: { lease: LeaseData; kind: "CheckIn" | "CheckOut" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const { send } = useTx();
  const t = useT();
  const label = kind === "CheckIn" ? "pickup" : "return";
  const testKey = kind === "CheckIn" ? "check-in" : "check-out"; // stable test ids, independent of the wording

  async function go() {
    setBusy(t("rental.evidence.uploading"));
    const { items, warning } = await uploadEvidence(files);
    setWarning(warning ?? null);
    for (const [i, item] of items.entries()) {
      setBusy(t("rental.evidence.anchoring", { i: i + 1, n: items.length }));
      const ok = await send(t(`rental.evidence.tx.${label}`, { i: i + 1, n: items.length }), {
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
        label={t(`rental.evidence.add.${label}`)}
        accept="image/jpeg,image/png,image/webp"
        multiple
        files={files}
        onChange={setFiles}
        hint={t("rental.evidence.fileHint")}
        testId={`${testKey}-photos`}
      />
      {warning && <Notice kind="warn">{warning}</Notice>}
      <ActionButton variant="secondary" busy={!!busy} disabledReason={files.length === 0 ? t(`rental.evidence.choose.${label}`) : null} onClick={go} data-testid={`anchor-${testKey}`}>
        {busy ?? t(files.length === 0 ? "rental.evidence.upload.zero" : files.length === 1 ? "rental.evidence.upload.one" : "rental.evidence.upload.other", { n: files.length })}
      </ActionButton>
    </div>
  );
}
