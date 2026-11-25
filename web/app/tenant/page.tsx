"use client";

import { useAccount } from "wagmi";
import { LeaseGrid } from "@/components/lease/LeaseCard";
import { CopyButton, PageTitle } from "@/components/ui";
import { shortAddress } from "@/lib/format";
import { WalletGate } from "@/components/WalletGate";
import { useLeaseList } from "@/lib/hooks/useLease";

const steps = [
  ["Fund", "Pay the deposit plus the first month's rent into this lease's own escrow (two wallet steps: approve, then fund)."],
  ["Live in", "Rent is paid out to the landlord month by month. You can prepay months or release rent early."],
  ["Move out", "Add check-out photos. The AI inspection proposes a deposit split; one side proposes, the other accepts."],
  ["Disagree?", "Open a dispute and the dispute desk rules. The landlord can never take the deposit alone."],
];

export default function TenantPage() {
  const { address } = useAccount();
  const { data } = useLeaseList("tenant", address);
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Tenant">
        Your deposit sits in a contract that only you and your landlord can settle together, with a neutral dispute desk as fallback.
      </PageTitle>
      <ol className="mb-8 grid gap-3 sm:grid-cols-4">
        {steps.map(([t, b], i) => (
          <li key={t} className="rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">
              {i + 1}. {t}
            </p>
            <p className="mt-1 text-muted">{b}</p>
          </li>
        ))}
      </ol>
      <WalletGate what="see the leases offered to you">
        <h2 className="mb-3 text-lg font-semibold">My leases</h2>
        <LeaseGrid
          addresses={data}
          empty={
            <>
              No leases for this wallet yet. Send your landlord your wallet address
              {address && (
                <>
                  {" "}
                  <span className="font-mono">{shortAddress(address)}</span> <CopyButton value={address} label="Copy my address" />
                </>
              )}{" "}
              and the lease appears here once they create it.
            </>
          }
        />
      </WalletGate>
    </section>
  );
}
