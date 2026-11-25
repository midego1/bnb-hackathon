"use client";

import { useEffect, useState } from "react";

/** The QR of a PromptPay-style payload, drawn as one SVG path. The `qr` encoder is loaded only when this mounts. */
export function PromptPayQr({ payload }: { payload: string }) {
  const [qr, setQr] = useState<{ payload: string; size: number; d: string }>();
  useEffect(() => {
    let live = true;
    import("qr").then(({ default: encodeQR }) => {
      const m = encodeQR(payload, "raw", { ecc: "medium", border: 2 });
      let d = "";
      m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
      if (live) setQr({ payload, size: m.length, d });
    });
    return () => {
      live = false;
    };
  }, [payload]);

  if (qr?.payload !== payload) return <div className="aspect-square w-56 animate-pulse rounded-lg bg-surface-strong" aria-label="Drawing the QR code" />;
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="w-56 rounded-lg bg-white" shapeRendering="crispEdges" role="img" aria-label="Demo PromptPay QR code" data-testid="promptpay-qr" data-payload={payload}>
      <path d={qr.d} fill="#000" />
    </svg>
  );
}
