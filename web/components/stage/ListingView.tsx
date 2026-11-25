"use client";

import { Card, PageTitle } from "@/components/ui";
import { formatFiat } from "@/lib/fiat";
import { shortAddress } from "@/lib/format";
import type { Listing } from "@/lib/listings";
import { useStageStatus } from "./client";

/** A physical item anyone can rent (/app/listings/<slug>): the live judge demo's listing. */
export function ListingView({ listing, enabled }: { listing: Listing; enabled: boolean }) {
  const { status } = useStageStatus(listing.slug, undefined, 3_600_000);
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={listing.name}>{listing.description}</PageTitle>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {listing.photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- small static listing photo
            <img key={src} src={src} alt={listing.name} className="w-full rounded-2xl border border-border object-cover" />
          ))}
        </div>
        <Card title="Rent this item">
          <dl className="grid grid-cols-2 gap-y-2 text-sm" data-testid="listing-terms">
            <dt className="text-muted">Rent</dt>
            <dd className="text-right font-semibold">{formatFiat(listing.rentThb, "THB")} / day</dd>
            <dt className="text-muted">Deposit</dt>
            <dd className="text-right font-semibold">{formatFiat(listing.depositThb, "THB")}</dd>
            <dt className="text-muted">Where</dt>
            <dd className="text-right">{listing.location}</dd>
            <dt className="text-muted">Owner</dt>
            <dd className="text-right font-mono">{status ? shortAddress(status.owner) : "KeyEscrow demo owner"}</dd>
          </dl>
          <p className="mt-4 text-sm text-muted">
            Rent and deposit go into this rental&apos;s own escrow on BNB Chain. The AI inspector compares pickup and return photos; both sides agree on the
            split.
          </p>
          {enabled ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={`/r/${listing.slug}`} className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover" data-testid="listing-rent">
                Rent this
              </a>
              <a href={`/stage/${listing.slug}`} className="inline-flex min-h-10 items-center rounded-lg border border-border-strong px-4 py-2 text-sm font-medium">
                Open the stage view
              </a>
            </div>
          ) : (
            <p className="mt-4 text-sm text-subtle">Renting is switched off on this server (live stage demo not enabled).</p>
          )}
        </Card>
      </div>
    </main>
  );
}
