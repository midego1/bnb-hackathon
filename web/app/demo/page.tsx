import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Play the demo" };

/**
 * One-click guided demo. Exists only in builds with NEXT_PUBLIC_DEV_ACCOUNTS=1: the inlined check is constant-folded,
 * so other builds answer 404 here and never bundle the demo runner (it is only reachable through the import below).
 */
export default async function DemoPage() {
  const { DemoGate } = process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" ? await import("@/components/demo/DemoGate") : notFound();
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8">
      <PageTitle title="Play the demo">
        One click plays the whole KeyEscrow story on the local chain: real contracts, real transactions, and the real lease page updating
        live underneath. The demo accounts switch by themselves.
      </PageTitle>
      <DemoGate />
    </section>
  );
}
