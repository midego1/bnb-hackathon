"use client";

import { useAccount } from "wagmi";
import { LeaseCard } from "@/components/lease/LeaseCard";
import { Notice, PageTitle, Skeleton } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { LeaseStatus } from "@/lib/contracts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useLease, useLeaseList } from "@/lib/hooks/useLease";
import { useT } from "@/lib/i18n/client";
import type { ReactNode } from "react";
import type { Address } from "viem";

export default function ArbiterPage() {
  const t = useT();
  const { address } = useAccount();
  const { deployment } = useDeployment();
  const { data } = useLeaseList("arbiter", address);
  const isDesk = !!address && deployment?.disputeDesk?.toLowerCase() === address.toLowerCase();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.h("desk.title")}>{t("desk.intro")}</PageTitle>
      <WalletGate what={t("desk.gate")}>
        {isDesk && <div className="mb-4"><Notice>{t("desk.isDesk")}</Notice></div>}
        {!data ? (
          <Skeleton className="h-36" />
        ) : data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-subtle">{t("desk.none")}</p>
        ) : (
          <div className="space-y-8">
            <Section title={t.h("desk.needsRuling")} addresses={data} want="disputed" empty={t("desk.needsEmpty")} />
            <Section title={t.h("desk.other")} addresses={data} want="other" empty={t("desk.otherEmpty")} />
          </div>
        )}
      </WalletGate>
    </section>
  );
}

function Section({ title, addresses, want, empty }: { title: ReactNode; addresses: readonly Address[]; want: "disputed" | "other"; empty: string }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {addresses.map((a) => (
          <Filtered key={a} address={a} want={want} />
        ))}
        {/* Shown only when no card rendered above (each Filtered renders nothing for leases of the other group). */}
        <p className="hidden rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-subtle only:block sm:col-span-2">
          {empty}
        </p>
      </div>
    </div>
  );
}

function Filtered({ address, want }: { address: Address; want: "disputed" | "other" }) {
  const { data } = useLease(address);
  if (!data) return want === "disputed" ? <Skeleton className="h-36" /> : null;
  const disputed = data.status === LeaseStatus.Disputed;
  if ((want === "disputed") !== disputed) return null;
  return <LeaseCard address={address} />;
}
