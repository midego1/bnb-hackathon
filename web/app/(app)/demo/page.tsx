import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoEntry } from "@/components/demo/DemoEntry";

export const metadata: Metadata = { title: "Play the demo" };

/**
 * One-click guided demo. Exists only in local anvil builds with NEXT_PUBLIC_DEV_ACCOUNTS=1 and in BSC testnet builds
 * with NEXT_PUBLIC_DEMO_TESTNET=1 (the live demo; its server routes still need DEMO_TESTNET_RUNNER=1). The inlined
 * checks are constant-folded: other builds answer 404 here, and DemoEntry drops the demo runner from their bundle.
 *
 * `data-demo-stage` pins the page to the viewport on desktop (app/globals.css): the demo is one screen, its panels
 * scroll on their own. Below `lg` the page stacks and scrolls as usual.
 */
export default function DemoPage() {
  const testnet = process.env.NEXT_PUBLIC_DEMO_TESTNET === "1" && process.env.NEXT_PUBLIC_CHAIN_ID === "97";
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1" && !testnet) notFound();
  return (
    <section data-demo-stage className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col px-4 py-4 lg:min-h-0 lg:py-3">
      <DemoEntry />
    </section>
  );
}
