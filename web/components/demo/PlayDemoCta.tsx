"use client";

import Link from "next/link";
import { useDeployment } from "@/lib/hooks/useDeployment";

/** Landing-page entry to the guided demo. Local anvil builds with the dev account switcher only. */
export function PlayDemoCta() {
  // Inlined env check: constant-folded at build time, so production bundles contain none of this.
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1") return null;
  return <Cta />;
}

function Cta() {
  const { chainId, deployment } = useDeployment();
  if (chainId !== 31337 || !deployment) return null;
  return (
    <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-warning-soft p-5 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800" data-testid="play-demo-cta">
      <div>
        <p className="font-semibold text-warning-fg">See the whole story in one click</p>
        <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
          A fresh Bangkok lease, funded, paid out, inspected by AI and settled, with real transactions on the local chain. About a minute.
        </p>
      </div>
      <Link
        href="/demo?autoplay=1"
        data-testid="play-demo"
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3 text-base font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300"
      >
        ▶ Play the demo
      </Link>
    </div>
  );
}
