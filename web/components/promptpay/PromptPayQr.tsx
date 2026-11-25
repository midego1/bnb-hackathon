"use client";

import encodeQR from "qr";
import { useT } from "@/lib/i18n/client";

/** The QR of a PromptPay-style payload, drawn as one SVG path. Loaded in the browser only (see PayWithPromptPay). */
export default function PromptPayQr({ payload }: { payload: string }) {
  const t = useT();
  const m = encodeQR(payload, "raw", { ecc: "medium", border: 2 });
  let d = "";
  m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg viewBox={`0 0 ${m.length} ${m.length}`} className="w-56 rounded-lg bg-white" shapeRendering="crispEdges" role="img" aria-label={t("promptpay.qrLabel")} data-testid="promptpay-qr" data-payload={payload}>
      <path d={d} fill="#000" />
    </svg>
  );
}
