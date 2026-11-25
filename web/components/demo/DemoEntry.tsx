"use client";

import dynamic from "next/dynamic";

/**
 * Client entry of /demo. The inlined env checks are constant-folded: a local anvil build (NEXT_PUBLIC_DEV_ACCOUNTS=1)
 * bundles the dev-account demo, a BSC testnet build with NEXT_PUBLIC_DEMO_TESTNET=1 the live testnet demo (signed by
 * the server, no keys in the browser), and any other build bundles no demo runner at all.
 */
const Gate =
  process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1"
    ? dynamic(() => import("./DemoGate").then((m) => m.DemoGate), {
        loading: () => <p className="text-sm text-subtle">Loading the demo…</p>,
      })
    : process.env.NEXT_PUBLIC_DEMO_TESTNET === "1" && process.env.NEXT_PUBLIC_CHAIN_ID === "97"
      ? dynamic(() => import("./TestnetDemoGate").then((m) => m.TestnetDemoGate), {
          loading: () => <p className="text-sm text-subtle">Loading the demo…</p>,
        })
      : () => null;

export function DemoEntry() {
  return <Gate />;
}
