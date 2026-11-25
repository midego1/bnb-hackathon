"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Amount, StatusBadge, useBaht } from "@/components/ui";
import { Button } from "@/components/ui/button";
import type { Scooter } from "@/lib/fleet";
import { useT } from "@/lib/i18n/client";
import type { RentalSummary } from "@/lib/rentals";
import { renterCopyFor, renterLine } from "./renterStory";

/** One rental as a big, plain card: the scooter, where it stands in one sentence, the money in baht, the next step. */
export function RentalCard({ r, scooter, now, you }: { r: RentalSummary; scooter?: Scooter; now: bigint; you: boolean }) {
  const baht = useBaht();
  const t = useT();
  const c = renterCopyFor(t);
  const line = renterLine(r, now, baht, c, you);
  return (
    <li className="grid gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" data-testid="renter-rental" data-address={r.address} data-status={r.status}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm text-subtle">
          <StatusBadge status={r.status} />
          {scooter?.location}
        </p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{scooter?.name ?? c.fallbackTitle}</h3>
        <p className="mt-1 text-base text-muted-foreground sm:text-lg" data-testid="rental-sentence">
          {line.sentence}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <Amount value={r.depositAmount} size="lg" />
            <p className="text-sm text-subtle">{t("renter.depositLabel")}</p>
          </div>
          <div>
            <Amount value={r.rentAmount} size="lg" />
            <p className="text-sm text-subtle">{c.per(r.rentPeriod)}</p>
          </div>
        </div>
      </div>
      <Button asChild size="lg" className="h-auto min-h-11 px-5 py-2.5 text-base whitespace-normal hover:bg-primary-hover">
        <Link href={`/lease/${r.address}`} data-testid="open-rental">
          {line.action} <ArrowRight aria-hidden />
        </Link>
      </Button>
    </li>
  );
}
