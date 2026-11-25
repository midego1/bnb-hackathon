import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoEntry } from "@/components/demo/DemoEntry";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Play the demo" };

/**
 * One-click guided demo. Exists only in builds with NEXT_PUBLIC_DEV_ACCOUNTS=1 (the inlined check is constant-folded):
 * other builds answer 404 here, and DemoEntry drops the demo runner from their bundle.
 */
export default function DemoPage() {
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1") notFound();
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8">
      <PageTitle title="Play the demo">
        One click plays the whole KeyEscrow story on the local chain: real contracts, real transactions, and the real lease page updating
        live underneath. The demo accounts switch by themselves.
      </PageTitle>
      <DemoEntry />
    </section>
  );
}
