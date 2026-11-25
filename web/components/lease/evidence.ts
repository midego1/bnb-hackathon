import type { Hex } from "viem";
import { EvidenceKind } from "@/lib/contracts";
import type { TimelineEvent } from "@/lib/hooks/useLeaseEvents";

/** All evidence hashes anchored on-chain for a rental, grouped by kind (from EvidenceAdded events). */
export function evidenceFromEvents(events: TimelineEvent[] | undefined) {
  const checkIn: Hex[] = [];
  const checkOut: Hex[] = [];
  const other: Hex[] = [];
  for (const e of events ?? []) {
    if (e.name !== "EvidenceAdded") continue;
    const hash = (e.args.contentHash as Hex).toLowerCase() as Hex;
    const kind = Number(e.args.kind);
    const list = kind === EvidenceKind.CheckIn ? checkIn : kind === EvidenceKind.CheckOut ? checkOut : other;
    if (!list.includes(hash)) list.push(hash);
  }
  return { checkIn, checkOut, other };
}
