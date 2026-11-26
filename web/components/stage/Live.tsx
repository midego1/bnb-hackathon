"use client";

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore, type ComponentProps } from "react";
import { FOLD_MEDIA } from "@/lib/fold";
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
 * /duo and /stage are one-screen desktop compositions (the `wide` + `stage` variants: >= 1024 px, landscape, >= 720 px
 * tall). An unfolded foldable (lib/fold.ts) gets the same picture: the page frames itself at a
 * 1280x800 desktop and scales that to fit, centred, and every tap still lands. Phones (folded cover screens too) and
 * tablets keep their stacked layout, and a framed page never frames itself again.
 */
const FIT = { w: 1280, h: 800 };
const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const fitScale = () => (window.parent === window && window.matchMedia(FOLD_MEDIA).matches ? Math.min(innerWidth / FIT.w, innerHeight / FIT.h) : 0);

function FitFrame({ src }: { src: string }) {
  const scale = useSyncExternalStore(subscribeResize, fitScale, () => 0);
  const t = useT();
  // The framed /duo tells which item its phone chose (DuoView): the address follows, as it does unframed.
  useEffect(() => {
    const onMessage = (e: MessageEvent<{ duoSlug?: unknown }>) => {
      const to = e.data?.duoSlug;
      if (e.origin === window.location.origin && typeof to === "string" && /^[a-z0-9-]+$/.test(to)) window.history.replaceState(null, "", `/duo/${to}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <div className="grid h-dvh place-items-center overflow-hidden" data-testid="fit-frame">
      <div style={{ width: FIT.w * scale, height: FIT.h * scale }}>
        <iframe src={src} title={t("stage.metaTitle")} width={FIT.w} height={FIT.h} className="block origin-top-left border-0" style={{ transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}

/**
 * One page entry serves three URLs (next.config.ts rewrites; each page entry costs Worker space):
 * /stage/<slug> the big screen, /r/<slug> the judge's phone (the QR code's short URL), /duo/<slug> both side by side
 * (it frames /r/<slug>?duo=1 as the phone).
 */
export function LiveScreen({ enabled, ...p }: ComponentProps<typeof StageView> & { enabled: boolean }) {
  const path = useSyncExternalStore(subscribeNothing, () => window.location.pathname, () => "");
  const fit = useSyncExternalStore(subscribeResize, () => fitScale() > 0, () => false);
  const t = useT();
  if (!path) return <Loading />;
  if (!enabled) return <p className="p-6 text-muted-foreground">{t("stage.disabled")}</p>;
  if (fit && !path.startsWith("/r/")) return <FitFrame src={path + window.location.search} />;
  if (path.startsWith("/duo/")) return <DuoView {...p} />;
  return path.startsWith("/r/") ? <JudgeTree {...p} duo={new URLSearchParams(window.location.search).has("duo")} /> : <StageView {...p} />;
}
