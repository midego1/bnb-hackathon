"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTestnetInfo } from "@/lib/demo/testnet";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { demoCopy } from "./copy";

/**
 * Landing-page entry to the guided demo: local anvil builds with the dev account switcher, and BSC testnet builds
 * with the live demo (NEXT_PUBLIC_DEMO_TESTNET=1) when the server's runner is switched on.
 */
export function PlayDemoCta() {
  // Inlined env checks: constant-folded at build time, so other production bundles contain none of this.
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1") return <Cta />;
  if (process.env.NEXT_PUBLIC_DEMO_TESTNET === "1" && process.env.NEXT_PUBLIC_CHAIN_ID === "97") return <TestnetCta />;
  return null;
}

function TestnetCta() {
  const { testnetCopy } = useT().of(demoCopy);
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchTestnetInfo().then(
      (info) => alive && setOn(!!info),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  if (!on) return null;
  return <CtaCard title={testnetCopy.ctaTitle} body={testnetCopy.ctaBody} />;
}

function Cta() {
  const { chainId, deployment } = useDeployment();
  if (chainId !== 31337 || !deployment) return null;
  return (
    <CtaCard
      title="See the whole story in one click"
      body="A fresh scooter rental, funded, paid out, inspected by AI and settled, with real transactions on the local chain. About a minute."
    />
  );
}

function CtaCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-highlight-edge bg-warning-soft p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="play-demo-cta">
      <div>
        <p className="font-semibold text-warning-fg">{title}</p>
        <p className="mt-1 text-sm text-warning-fg/80">{body}</p>
      </div>
      <Link
        href="/demo?autoplay=1"
        data-testid="play-demo"
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-highlight px-6 py-3 text-base font-semibold text-highlight-foreground shadow-sm transition hover:bg-highlight-hover"
      >
        <Play aria-hidden className="size-4 fill-current" />
        Play the demo
      </Link>
    </div>
  );
}
