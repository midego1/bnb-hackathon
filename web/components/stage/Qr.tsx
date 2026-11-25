"use client";

import encodeQR from "qr";

/** A QR code as crisp SVG (dark on white, whatever the theme). Loaded lazily by the stage view (next/dynamic). */
export default function Qr({ text, label }: { text: string; label: string }) {
  const m = encodeQR(text, "raw", { ecc: "medium", border: 2 });
  let d = "";
  m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg viewBox={`0 0 ${m.length} ${m.length}`} role="img" aria-label={label} shapeRendering="crispEdges" className="h-full w-full" data-testid="stage-qr">
      <rect width={m.length} height={m.length} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
