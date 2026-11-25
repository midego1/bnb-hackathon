"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore, type ComponentProps } from "react";

/**
 * The stage screens render in the browser only. Server-rendering them would put a second copy of the wallet stack
 * (wagmi, RainbowKit, viem) into the Cloudflare Worker, which has no room for it (the 3 MiB Free limit).
 */
// Not imported from ./wallet: that would pull viem into this page's server chunks.
const subscribeNothing = () => () => {};
const Loading = () => <p className="p-6 text-muted-foreground">Loading…</p>;
const StageView = dynamic(() => import("./StageView").then((m) => m.StageView), { ssr: false, loading: Loading });
const JudgeTree = dynamic(() => import("./JudgeTree"), { ssr: false, loading: Loading });

/**
 * One page entry serves two URLs (next.config.ts rewrite; each page entry costs Worker space):
 * /stage/<slug> the big screen, /r/<slug> the judge's phone (the QR code's short URL).
 */
export function LiveScreen({ enabled, ...p }: ComponentProps<typeof StageView> & { enabled: boolean }) {
  const path = useSyncExternalStore(subscribeNothing, () => window.location.pathname, () => "");
  if (!path) return <Loading />;
  if (!enabled) return <p className="p-6 text-muted-foreground">The live stage demo is not enabled on this server.</p>;
  return path.startsWith("/r/") ? <JudgeTree {...p} /> : <StageView {...p} />;
}
