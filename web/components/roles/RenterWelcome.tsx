"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { RenterArt } from "@/components/lease/Art";
import { rentalCopy as c } from "@/components/lease/copy";
import { sampleRental } from "@/components/lease/story";
import { demoAvailable } from "@/components/shell/nav";
import { Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { useRentals } from "@/lib/hooks/useRentals";
import { RentalCard } from "./RentalCard";
import { useFleet } from "./shared";

/** /tenant without a wallet: what renting here means, one live rental from the chain, and a way in. */
export function RenterWelcome() {
  const { data: index, isLoading } = useRentals();
  const { data: fleet } = useFleet();
  const sample = index && sampleRental(index.rentals);
  const scooter = sample && fleet?.scooters.find((s) => s.rentals.some((r) => r.toLowerCase() === sample.address.toLowerCase()));
  const r = c.renter;

  return (
    <div className="space-y-10" data-testid="renter-welcome">
      <section className="grid items-center gap-6 rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-10 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">{r.heroTitle}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{r.heroBody}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => (
                <Button size="lg" className="h-auto min-h-11 px-5 py-2.5 text-base hover:bg-primary-hover" onClick={openConnectModal} disabled={!mounted} data-testid="renter-connect">
                  {r.connect} <ArrowRight aria-hidden />
                </Button>
              )}
            </ConnectButton.Custom>
            <Button asChild size="lg" variant="outline" className="h-auto min-h-11 px-5 py-2.5 text-base">
              {demoAvailable ? (
                <Link href="/demo" data-testid="renter-demo">
                  <Play aria-hidden /> {r.demo}
                </Link>
              ) : (
                <Link href="/how-it-works" data-testid="renter-demo">
                  <Play aria-hidden /> {r.howItWorks}
                </Link>
              )}
            </Button>
          </div>
          {process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" && <p className="mt-4 text-sm text-subtle">{r.devHint}</p>}
        </div>
        <RenterArt className="hidden w-full md:block" />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">{r.sampleTitle}</h2>
        {sample ? (
          <ul data-testid="renter-sample">
            <RentalCard r={sample} scooter={scooter} now={index.chainNow} you={false} />
          </ul>
        ) : isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <p className="text-base text-muted-foreground">{r.sampleNone}</p>
        )}
      </section>
    </div>
  );
}
