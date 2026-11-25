"use client";

import dynamic from "next/dynamic";

/**
 * Client entry of /demo. The inlined env check is constant-folded, so in builds without NEXT_PUBLIC_DEV_ACCOUNTS=1
 * the dynamic import below is dead code and the demo runner is not bundled at all.
 */
const Gate =
  process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1"
    ? dynamic(() => import("./DemoGate").then((m) => m.DemoGate), {
        loading: () => <p className="text-sm text-slate-500">Loading the demo…</p>,
      })
    : () => null;

export function DemoEntry() {
  return <Gate />;
}
