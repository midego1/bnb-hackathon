"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore, type ComponentProps } from "react";
import { useT } from "@/lib/i18n/client";

/**
 * The stage screens render in the browser only. Server-rendering them would put a second copy of the wallet stack
 * (wagmi, RainbowKit, viem) into the Cloudflare Worker, which has no room for it (the 3 MiB Free limit).
 */
// Not imported from ./wallet: that would pull viem into this page's server chunks.
const subscribeNothing = () => () => {};
function Loading() {
  return <p className="p-6 text-muted-foreground">{useT()("stage.loading")}</p>;
}
const StageView = dynamic(() => import("./StageView").then((m) => m.StageView), { ssr: false, loading: Loading });
const JudgeTree = dynamic(() => import("./JudgeTree"), { ssr: false, loading: Loading });
const DuoView = dynamic(() => import("./DuoView").then((m) => m.DuoView), { ssr: false, loading: Loading });

/**
 * One page entry serves three URLs (next.config.ts rewrites; each page entry costs Worker space):
 * /stage/<slug> the big screen, /r/<slug> the judge's phone (the QR code's short URL), /duo/<slug> both side by side
 * (it frames /r/<slug>?duo=1 as the phone).
 */
export function LiveScreen({ enabled, ...p }: ComponentProps<typeof StageView> & { enabled: boolean }) {
  const path = useSyncExternalStore(subscribeNothing, () => window.location.pathname, () => "");
  const t = useT();
  if (!path) return <Loading />;
  if (!enabled) return <p className="p-6 text-muted-foreground">{t("stage.disabled")}</p>;
  if (path.startsWith("/duo/")) return <DuoView {...p} />;
  return path.startsWith("/r/") ? <JudgeTree {...p} duo={new URLSearchParams(window.location.search).has("duo")} /> : <StageView {...p} />;
}
