import type { ReactNode } from "react";
import type { RentalKind } from "./script";

/**
 * Hand-made inline SVG drawings for /how-it-works. Each draws around its own origin (people: between the feet;
 * things: their centre) so the stage only places them. Outlines use one fixed ink so the cartoon reads the same on the
 * light and dark stage; text that sits on the stage itself uses the theme tokens.
 */

export const INK = "#1e293b";
const STROKE = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

export const COLORS = {
  landlord: "#14b8a6",
  landlordDark: "#0f766e",
  tenant: "#8b5cf6",
  tenantDark: "#6d28d9",
  gold: "#fbbf24",
  goldDark: "#b45309",
  glass: "#7dd3fc",
  metal: "#94a3b8",
  stamp: "#e11d48",
};

export type Mood = "happy" | "worried" | "sleep" | "cross" | "neutral";

/** A friendly person: 200 units tall, origin between the feet. */
export function Person({ who, mood = "happy", wave = 0 }: { who: "landlord" | "tenant" | "referee"; mood?: Mood; wave?: number }) {
  const look = {
    landlord: { shirt: COLORS.landlord, pants: "#334155", skin: "#c98f65", hair: "#2b1d16" },
    tenant: { shirt: COLORS.tenant, pants: "#1e3a8a", skin: "#f3c9a3", hair: "#7c3f1d" },
    referee: { shirt: "#f8fafc", pants: "#0f172a", skin: "#e8b48c", hair: "#475569" },
  }[who];
  return (
    <g>
      {/* legs + shoes */}
      <rect x={-24} y={-48} width={18} height={44} rx={7} fill={look.pants} {...STROKE} />
      <rect x={6} y={-48} width={18} height={44} rx={7} fill={look.pants} {...STROKE} />
      <ellipse cx={-17} cy={-4} rx={15} ry={7} fill={INK} />
      <ellipse cx={17} cy={-4} rx={15} ry={7} fill={INK} />
      {/* arms */}
      <rect x={-54} y={-122} width={18} height={64} rx={9} fill={look.shirt} {...STROKE} transform={`rotate(${8} -45 -118)`} />
      <g transform={`rotate(${-8 - wave * 120} 45 -118)`}>
        <rect x={36} y={-122} width={18} height={64} rx={9} fill={look.shirt} {...STROKE} />
        <circle cx={45} cy={-56} r={10} fill={look.skin} {...STROKE} />
      </g>
      <circle cx={-46} cy={-56} r={10} fill={look.skin} {...STROKE} />
      {/* body */}
      <rect x={-38} y={-128} width={76} height={86} rx={28} fill={look.shirt} {...STROKE} />
      {who === "referee" &&
        [-24, -8, 8, 24].map((x) => <rect key={x} x={x - 4} y={-126} width={8} height={82} fill={INK} opacity={0.85} />)}
      {who === "landlord" && <path d="M0 -126 L-8 -112 L0 -80 L8 -112 Z" fill="#fde68a" {...STROKE} strokeWidth={2} />}
      {who === "tenant" && <path d="M-26 -124 L-20 -60" stroke="#fbbf24" strokeWidth={7} strokeLinecap="round" />}
      {/* head */}
      <rect x={-8} y={-140} width={16} height={16} fill={look.skin} />
      <circle cx={0} cy={-162} r={36} fill={look.skin} {...STROKE} />
      <Hair who={who} color={look.hair} />
      <Face mood={mood} glasses={who === "landlord"} />
      {who === "referee" && <circle cx={0} cy={-104} r={6} fill="#fbbf24" {...STROKE} strokeWidth={2} />}
    </g>
  );
}

function Hair({ who, color }: { who: "landlord" | "tenant" | "referee"; color: string }) {
  if (who === "tenant")
    return (
      <g fill={color} {...STROKE}>
        <path d="M-36 -160 C-40 -205 40 -205 36 -160 C26 -178 -10 -186 -36 -160 Z" />
        <path d="M30 -176 C58 -170 58 -130 44 -118 C46 -140 40 -156 30 -166 Z" />
      </g>
    );
  if (who === "referee")
    return <path d="M-37 -168 C-30 -204 30 -204 37 -168 L37 -176 C20 -190 -20 -190 -37 -176 Z" fill={color} {...STROKE} />;
  return <path d="M-36 -164 C-38 -204 38 -204 36 -164 C30 -176 14 -184 -4 -180 C-18 -184 -30 -178 -36 -164 Z" fill={color} {...STROKE} />;
}

function Face({ mood, glasses }: { mood: Mood; glasses?: boolean }) {
  const mouth = {
    happy: "M-13 -146 Q0 -132 13 -146",
    worried: "M-11 -140 Q0 -149 11 -140",
    sleep: "M-6 -143 Q0 -139 6 -143",
    cross: "M-12 -141 L12 -143",
    neutral: "M-9 -143 L9 -143",
  }[mood];
  return (
    <g>
      {mood === "sleep" ? (
        <g fill="none" {...STROKE}>
          <path d="M-19 -163 Q-12 -157 -5 -163" />
          <path d="M5 -163 Q12 -157 19 -163" />
        </g>
      ) : (
        <g fill={INK}>
          <circle cx={-12} cy={-164} r={4.5} />
          <circle cx={12} cy={-164} r={4.5} />
        </g>
      )}
      {mood === "worried" && <path d="M-20 -178 L-6 -174 M20 -178 L6 -174" {...STROKE} />}
      {mood === "cross" && <path d="M-20 -176 L-6 -171 M20 -176 L6 -171" {...STROKE} />}
      {glasses && (
        <g fill="none" {...STROKE} strokeWidth={2.5}>
          <circle cx={-12} cy={-164} r={10} />
          <circle cx={12} cy={-164} r={10} />
          <path d="M-2 -165 L2 -165" />
        </g>
      )}
      <circle cx={-22} cy={-148} r={6} fill="#fb7185" opacity={0.45} />
      <circle cx={22} cy={-148} r={6} fill="#fb7185" opacity={0.45} />
      <path d={mouth} fill="none" {...STROKE} />
    </g>
  );
}

/** A padlock, origin at the centre of its body. `open` 0..1 lifts the shackle. */
export function Padlock({ color, dark, open }: { color: string; dark: string; open: number }) {
  return (
    <g>
      <g transform={`translate(${open * 9} ${-open * 14}) rotate(${open * 18} 14 -14)`}>
        <path d="M-14 -12 V-26 A14 14 0 0 1 14 -26 V-12" fill="none" stroke={INK} strokeWidth={11} strokeLinecap="round" />
        <path d="M-14 -12 V-26 A14 14 0 0 1 14 -26 V-12" fill="none" stroke={COLORS.metal} strokeWidth={6} strokeLinecap="round" />
      </g>
      <rect x={-24} y={-16} width={48} height={40} rx={9} fill={color} {...STROKE} />
      <circle cx={0} cy={0} r={6} fill={dark} />
      <path d="M0 2 L0 13" stroke={dark} strokeWidth={5} strokeLinecap="round" />
    </g>
  );
}

/** A key, origin at its bow. */
export function Key({ color }: { color: string }) {
  return (
    <g {...STROKE} strokeWidth={2.5}>
      <path d="M10 -4 H44 V4 H40 V12 H33 V4 H26 V10 H20 V4 H10 Z" fill={color} />
      <circle cx={0} cy={0} r={13} fill={color} />
      <circle cx={0} cy={0} r={5} fill="var(--surface)" />
    </g>
  );
}

/** A coin with a baht sign, origin at its centre. */
export function Coin({ r = 15 }: { r?: number }) {
  return (
    <g>
      <circle r={r} fill={COLORS.gold} stroke={COLORS.goldDark} strokeWidth={2.5} />
      <circle r={r * 0.68} fill="none" stroke={COLORS.goldDark} strokeWidth={1.5} opacity={0.6} />
      <text y={r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight={700} fill={COLORS.goldDark}>
        ฿
      </text>
    </g>
  );
}

/** Pile of coins seen through glass: `fill` 0..1 of `height`, rising from the bottom of a w x h window at the origin. */
function CoinPile({ id, w, h, fill }: { id: string; w: number; h: number; fill: number }) {
  const fh = Math.max(0, Math.min(1, fill)) * h;
  return (
    <g>
      <defs>
        <pattern id={id} width={26} height={16} patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${h - fh})`}>
          <rect width={26} height={16} fill="#f59e0b" />
          <ellipse cx={13} cy={8} rx={12} ry={6} fill={COLORS.gold} stroke={COLORS.goldDark} strokeWidth={1.5} />
          <ellipse cx={0} cy={0} rx={12} ry={6} fill={COLORS.gold} stroke={COLORS.goldDark} strokeWidth={1.5} />
          <ellipse cx={26} cy={0} rx={12} ry={6} fill={COLORS.gold} stroke={COLORS.goldDark} strokeWidth={1.5} />
          <ellipse cx={0} cy={16} rx={12} ry={6} fill={COLORS.gold} stroke={COLORS.goldDark} strokeWidth={1.5} />
          <ellipse cx={26} cy={16} rx={12} ry={6} fill={COLORS.gold} stroke={COLORS.goldDark} strokeWidth={1.5} />
        </pattern>
      </defs>
      {fh > 0 && <rect x={0} y={h - fh} width={w} height={fh} rx={8} fill={`url(#${id})`} />}
    </g>
  );
}

/** The see-through safe: 240 x 210, origin at the bottom centre. `fill` 0..1, locks given separately. */
export function Safe({ fill, children }: { fill: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={-130} y={-12} width={260} height={14} rx={6} fill={COLORS.metal} {...STROKE} />
      <rect x={-120} y={-215} width={240} height={205} rx={22} fill="#475569" {...STROKE} />
      <rect x={-104} y={-199} width={208} height={173} rx={12} fill={COLORS.glass} opacity={0.35} />
      <g transform="translate(-104 -199)">
        <CoinPile id="eli5-safe-coins" w={208} h={173} fill={fill} />
      </g>
      <rect x={-104} y={-199} width={208} height={173} rx={12} fill="none" stroke="#e2e8f0" strokeWidth={3} />
      <path d="M-88 -186 L-60 -186 M-88 -186 L-88 -150" stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity={0.7} />
      {children}
    </g>
  );
}

/** KeyEscrow's tip jar: origin at the bottom centre, ~100 tall. */
export function Jar({ fill }: { fill: number }) {
  return (
    <g>
      <rect x={-34} y={-104} width={68} height={16} rx={5} fill="#f59e0b" {...STROKE} />
      <path d="M-30 -88 C-44 -80 -44 -10 -30 -2 H30 C44 -10 44 -80 30 -88 Z" fill={COLORS.glass} fillOpacity={0.35} {...STROKE} />
      <g transform="translate(-34 -62)">
        <CoinPile id="eli5-jar-coins" w={68} h={58} fill={fill} />
      </g>
      <rect x={-33} y={-74} width={66} height={18} rx={4} fill="#fef3c7" stroke={INK} strokeWidth={2} />
      <text x={0} y={-61} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={INK}>
        KeyEscrow
      </text>
    </g>
  );
}

/** The little AI inspector robot: origin at its body centre. */
export function Robot({ glass }: { glass?: { x: number; y: number } }) {
  return (
    <g>
      <path d="M0 -62 V-78" {...STROKE} />
      <circle cx={0} cy={-82} r={7} fill="#f43f5e" {...STROKE} />
      <rect x={-40} y={-62} width={80} height={60} rx={16} fill="#cbd5e1" {...STROKE} />
      <rect x={-30} y={-52} width={60} height={38} rx={10} fill="#0f172a" />
      <circle cx={-12} cy={-34} r={6} fill="#22d3ee" />
      <circle cx={12} cy={-34} r={6} fill="#22d3ee" />
      <path d="M-8 -22 Q0 -17 8 -22" stroke="#22d3ee" strokeWidth={3} fill="none" strokeLinecap="round" />
      <rect x={-30} y={4} width={60} height={46} rx={12} fill="#e2e8f0" {...STROKE} />
      <circle cx={0} cy={26} r={8} fill="#fbbf24" {...STROKE} strokeWidth={2} />
      {/* propeller-free hover: a little jet glow */}
      <ellipse cx={0} cy={62} rx={18} ry={6} fill="#38bdf8" opacity={0.5} />
      {glass && (
        <g>
          <path d={`M30 18 Q${(30 + glass.x) / 2} ${Math.min(18, glass.y) - 20} ${glass.x - 18} ${glass.y + 18}`} fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
          <path d={`M30 18 Q${(30 + glass.x) / 2} ${Math.min(18, glass.y) - 20} ${glass.x - 18} ${glass.y + 18}`} fill="none" stroke="#cbd5e1" strokeWidth={3} strokeLinecap="round" />
          <g transform={`translate(${glass.x} ${glass.y})`}>
            <path d="M-17 17 L-32 32" stroke="#92400e" strokeWidth={9} strokeLinecap="round" />
            <circle r={24} fill="#e0f2fe" fillOpacity={0.45} stroke={INK} strokeWidth={5} />
            <path d="M-12 -8 Q-8 -14 -2 -15" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" />
          </g>
        </g>
      )}
    </g>
  );
}

/** The referee's desk with a gavel; `swing` 0..1 lifts the gavel. Origin at the bottom centre. */
export function RefereeDesk({ swing }: { swing: number }) {
  return (
    <g>
      <g transform={`rotate(${-swing * 50} 52 -96)`}>
        <rect x={40} y={-110} width={44} height={20} rx={5} fill="#92400e" {...STROKE} />
        <path d="M62 -92 L62 -56" stroke="#92400e" strokeWidth={8} strokeLinecap="round" />
      </g>
      <rect x={-82} y={-62} width={164} height={62} rx={8} fill="#a16207" {...STROKE} />
      <rect x={-82} y={-70} width={164} height={14} rx={5} fill="#ca8a04" {...STROKE} />
    </g>
  );
}

/** The rented thing, ~150 wide, origin at its centre. */
export function RentalArt({ kind, damage = false }: { kind: RentalKind; damage?: boolean }) {
  if (kind === "scooter")
    return (
      <g>
        {/* wheels */}
        <circle cx={-46} cy={34} r={21} fill={INK} />
        <circle cx={-46} cy={34} r={9} fill="#cbd5e1" />
        <circle cx={54} cy={34} r={21} fill={INK} />
        <circle cx={54} cy={34} r={9} fill="#cbd5e1" />
        {/* front fork + handlebar */}
        <path d="M54 34 L40 -44" {...STROKE} strokeWidth={7} />
        <path d="M40 -44 L36 -62 M24 -64 H50" {...STROKE} strokeWidth={6} />
        {/* rear body with seat, floorboard, front shield, fender */}
        <path d="M-80 22 C-84 -4 -70 -22 -44 -24 H-6 C4 -24 6 -10 2 4 L-2 14 H-78 Z" fill="#ef4444" {...STROKE} />
        <rect x={-66} y={-38} width={56} height={16} rx={8} fill="#334155" {...STROKE} />
        <path d="M-4 6 H30 L32 18 H-6 Z" fill="#cbd5e1" {...STROKE} />
        <path d="M26 18 L34 -34 C36 -42 48 -44 50 -36 L44 10 C42 16 36 18 30 18 Z" fill="#ef4444" {...STROKE} />
        <path d="M34 8 C40 -4 66 -4 74 14" fill="none" {...STROKE} strokeWidth={5} />
        <circle cx={47} cy={-50} r={7} fill="#fde68a" {...STROKE} strokeWidth={2} />
        {damage && <path d="M-60 -4 L-50 -10 L-42 -2 L-32 -9" stroke="#7f1d1d" strokeWidth={4} fill="none" strokeLinecap="round" />}
      </g>
    );
  return (
    <g>
      <rect x={-62} y={-14} width={124} height={68} rx={4} fill="#fde68a" {...STROKE} />
      <path d="M-78 -10 L0 -66 L78 -10 Z" fill="#ef4444" {...STROKE} />
      <rect x={-14} y={16} width={28} height={38} rx={3} fill="#92400e" {...STROKE} />
      <circle cx={8} cy={36} r={2.5} fill={INK} />
      <rect x={-50} y={2} width={26} height={22} rx={3} fill="#7dd3fc" {...STROKE} />
      <rect x={24} y={2} width={26} height={22} rx={3} fill="#7dd3fc" {...STROKE} />
      <rect x={34} y={-58} width={14} height={26} fill="#64748b" {...STROKE} />
      {damage && <path d="M-46 36 L-38 30 L-32 38 L-24 31" stroke="#7f1d1d" strokeWidth={4} fill="none" strokeLinecap="round" />}
    </g>
  );
}

/** An instant photo of the rental, 150 x 140, origin at its centre. */
export function Photo({ kind, damage, label, ring = 0 }: { kind: RentalKind; damage?: boolean; label: string; ring?: number }) {
  return (
    <g>
      <rect x={-75} y={-70} width={150} height={140} rx={6} fill="#fff" {...STROKE} />
      <rect x={-64} y={-60} width={128} height={98} fill="#e0f2fe" />
      <g transform="translate(0 -6) scale(0.62)">
        <RentalArt kind={kind} damage={damage} />
      </g>
      {ring > 0 && (
        <ellipse
          cx={kind === "scooter" ? -28 : -22}
          cy={kind === "scooter" ? -10 : 14}
          rx={22}
          ry={16}
          fill="none"
          stroke="#e11d48"
          strokeWidth={4}
          strokeDasharray={140}
          strokeDashoffset={140 * (1 - ring)}
        />
      )}
      <text x={0} y={58} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>
        {label}
      </text>
    </g>
  );
}

/** A small rental agreement with two signature lines, origin at its centre. */
export function Paper({ title, signed }: { title: string; signed: number }) {
  return (
    <g>
      <path d="M-55 -70 H35 L55 -50 V70 H-55 Z" fill="#fff" {...STROKE} />
      <path d="M35 -70 V-50 H55" fill="#e2e8f0" {...STROKE} strokeWidth={2} />
      <text x={-40} y={-40} fontSize={16} fontWeight={700} fill={INK}>
        {title}
      </text>
      {[-20, -6, 8].map((y) => (
        <path key={y} d={`M-40 ${y} H40`} stroke="#cbd5e1" strokeWidth={4} strokeLinecap="round" />
      ))}
      <path d="M-42 48 H-6 M8 48 H44" stroke="#94a3b8" strokeWidth={2} />
      <path d="M-40 44 c6 -10 10 6 16 -4 s8 4 14 -2" fill="none" stroke={COLORS.landlordDark} strokeWidth={3} strokeLinecap="round" opacity={signed > 0.3 ? 1 : 0} />
      <path d="M10 44 c6 -10 10 6 16 -4 s8 4 14 -2" fill="none" stroke={COLORS.tenantDark} strokeWidth={3} strokeLinecap="round" opacity={signed > 0.6 ? 1 : 0} />
    </g>
  );
}

/** A rubber stamp mark, origin at its centre. */
export function Stamp({ text }: { text: string }) {
  return (
    <g transform="rotate(-14)">
      <rect x={-78} y={-26} width={156} height={52} rx={10} fill="none" stroke={COLORS.stamp} strokeWidth={6} />
      <rect x={-70} y={-18} width={140} height={36} rx={6} fill="none" stroke={COLORS.stamp} strokeWidth={2} />
      <text x={0} y={10} textAnchor="middle" fontSize={28} fontWeight={800} letterSpacing={3} fill={COLORS.stamp}>
        {text}
      </text>
    </g>
  );
}

/** A tear-off calendar page, origin at its centre. */
export function Calendar({ label }: { label: string }) {
  return (
    <g>
      <rect x={-56} y={-50} width={112} height={100} rx={10} fill="#fff" {...STROKE} />
      <path d="M-56 -22 V-40 A10 10 0 0 1 -46 -50 H46 A10 10 0 0 1 56 -40 V-22 Z" fill="#ef4444" {...STROKE} />
      <circle cx={-28} cy={-50} r={5} fill={INK} />
      <circle cx={28} cy={-50} r={5} fill={INK} />
      <text x={0} y={22} textAnchor="middle" fontSize={label.length > 6 ? 22 : 26} fontWeight={800} fill={INK}>
        {label}
      </text>
    </g>
  );
}

/** A speech bubble whose tail points at (tx, ty), relative to the bubble's top-left corner at the origin. */
export function Bubble({ w, h, tx, ty, children, think }: { w: number; h: number; tx: number; ty: number; children: ReactNode; think?: boolean }) {
  const bx = Math.max(24, Math.min(w - 24, tx));
  const tail = ty > h ? `M${bx - 14} ${h - 2} L${tx} ${ty} L${bx + 14} ${h - 2}` : `M${bx - 14} 2 L${tx} ${ty} L${bx + 14} 2`;
  return (
    <g>
      {think ? (
        <g fill="var(--surface)" stroke="var(--foreground)" strokeWidth={3}>
          <circle cx={tx + (bx - tx) * 0.35} cy={ty + (h - ty) * 0.35} r={6} />
          <circle cx={tx + (bx - tx) * 0.65} cy={ty + (h - ty) * 0.65} r={9} />
        </g>
      ) : (
        <path d={tail} fill="var(--surface)" stroke="var(--foreground)" strokeWidth={6} strokeLinejoin="round" />
      )}
      <rect width={w} height={h} rx={18} fill="var(--surface)" stroke="var(--foreground)" strokeWidth={3} />
      {!think && <path d={tail} fill="var(--surface)" />}
      {children}
    </g>
  );
}
