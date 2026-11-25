import type { ReactNode } from "react";
import { INK } from "@/components/eli5/Drawings";

/** The extra props for /pitch, in the /how-it-works style (components/eli5/Drawings.tsx): fixed ink, own origin. */

const STROKE = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

/** The big screen behind us: w x h, origin at its top centre. Dark in both themes, like a projector. */
export function BigScreen({ w, h, children }: { w: number; h: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={-w / 2 - 10} y={-10} width={w + 20} height={h + 20} rx={16} fill="#334155" {...STROKE} />
      <rect x={-w / 2} y={0} width={w} height={h} rx={8} fill="#0f172a" />
      {children}
    </g>
  );
}

/** A decorative QR code, size x size, origin at its top-left. shortcut: not scannable; draw a real one if this page ever replaces the live QR. */
export function Qr({ size }: { size: number }) {
  const n = 21;
  const u = size / n;
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x * u} y={y * u} width={7 * u} height={7 * u} fill="#0f172a" />
      <rect x={(x + 1) * u} y={(y + 1) * u} width={5 * u} height={5 * u} fill="#fff" />
      <rect x={(x + 2) * u} y={(y + 2) * u} width={3 * u} height={3 * u} fill="#0f172a" />
    </g>
  );
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
  const cells: ReactNode[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (!inFinder(x, y) && (x * 7 + y * 13 + x * y) % 3 === 0) cells.push(<rect key={`${x}.${y}`} x={x * u} y={y * u} width={u} height={u} fill="#0f172a" />);
  return (
    <g>
      <rect x={-8} y={-8} width={size + 16} height={size + 16} rx={6} fill="#fff" />
      {cells}
      {finder(0, 0)}
      {finder(14, 0)}
      {finder(0, 14)}
    </g>
  );
}

/** A phone, 36 x 64, origin at its centre; `label` shows on its screen. */
export function Phone({ label }: { label?: string }) {
  return (
    <g>
      <rect x={-18} y={-32} width={36} height={64} rx={7} fill="#1e293b" {...STROKE} strokeWidth={2.5} />
      <rect x={-14} y={-25} width={28} height={46} rx={3} fill="#e0f2fe" />
      {label && (
        <text y={3} textAnchor="middle" fontSize={11} fontWeight={800} fill={INK}>
          {label}
        </text>
      )}
    </g>
  );
}

/** Our physical Mystery Box, ~90 x 80, origin at its bottom centre. */
export function MysteryBox({ mark, scuff }: { mark: string; scuff?: boolean }) {
  return (
    <g>
      <path d="M-46 -60 L-30 -80 H46 L30 -60 Z" fill="#fcd34d" {...STROKE} />
      <path d="M30 -60 L46 -80 V-20 L30 0 Z" fill="#d97706" {...STROKE} />
      <rect x={-46} y={-60} width={76} height={60} rx={3} fill="#f59e0b" {...STROKE} />
      <path d="M-8 -60 V0" stroke="#fef3c7" strokeWidth={8} opacity={0.7} />
      <text x={-8} y={-17} textAnchor="middle" fontSize={40} fontWeight={900} fill="#7c2d12">
        {mark}
      </text>
      {scuff && <path d="M-40 -46 L-32 -52 L-26 -44 L-18 -50" stroke="#7f1d1d" strokeWidth={4} fill="none" strokeLinecap="round" data-testid="pitch-scuff" />}
    </g>
  );
}

/** A passport, ~56 x 74, origin at its centre. */
export function Passport({ label }: { label: string }) {
  return (
    <g>
      <rect x={-28} y={-37} width={56} height={74} rx={6} fill="#7f1d1d" {...STROKE} />
      <circle cx={0} cy={-4} r={13} fill="none" stroke="#fbbf24" strokeWidth={2.5} />
      <path d="M-13 -4 H13 M0 -17 C-7 -10 -7 2 0 9 C7 2 7 -10 0 -17" fill="none" stroke="#fbbf24" strokeWidth={1.5} />
      <text y={26} textAnchor="middle" fontSize={8.5} fontWeight={800} letterSpacing={0.6} fill="#fbbf24">
        {label}
      </text>
    </g>
  );
}

/** A mouse pointer, tip at the origin. */
export function Pointer() {
  return <path d="M0 0 L0 30 L8 23 L14 36 L20 33 L14 21 L24 21 Z" fill="#fff" {...STROKE} strokeWidth={2.5} />;
}
