"use client";

import { useAccount } from "wagmi";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { Renter } from "@/components/roles/Renter";
import { CopyButton, PageTitle } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";

const steps = [
  ["Fund", "Pay the deposit plus the first month's rent into this rental's own escrow (two wallet steps: approve, then fund)."],
  ["Ride", "Rent is paid out to the owner month by month. You can prepay months or release rent early."],
  ["Return", "Bring the scooter back and add return photos. The AI inspection proposes a deposit split; one side proposes, the other accepts."],
  ["Disagree?", "Open a dispute and the dispute desk rules. The owner can never take the deposit alone."],
];

export default function TenantPage() {
  const { address } = useAccount();
  const { data } = useLeaseList("tenant", address);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Renter">
        Book a scooter, pay deposit + rent into the rental&apos;s own escrow, and get your deposit back without leaving your passport. The
        deposit only moves when you and the shop agree, or a neutral dispute desk rules.
      </PageTitle>
      <ol className="mb-8 hidden gap-3 sm:grid sm:grid-cols-4">
        {steps.map(([t, b], i) => (
          <li key={t} className="rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">
              {i + 1}. {t}
            </p>
            <p className="mt-1 text-muted-foreground">{b}</p>
          </li>
        ))}
      </ol>
      <WalletGate what="book a scooter and see your rentals">
        <Renter />
        <h2 className="mb-3 mt-8 text-lg font-semibold">All rental contracts for this wallet</h2>
        <LeaseGrid
          addresses={data}
          empty={
            <>
              No rentals for this wallet yet. Send your owner your wallet address
              {address && (
                <>
                  {" "}
                  <span className="font-mono">{shortAddress(address)}</span> <CopyButton value={address} label="Copy my address" />
                </>
              )}{" "}
              and the rental appears here once they create it.
            </>
          }
        />
      </WalletGate>
    </section>
  );
}
