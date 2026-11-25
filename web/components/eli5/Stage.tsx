import type { ReactNode } from "react";
import { Bubble, Calendar, Coin, COLORS, Jar, Key, Padlock, Paper, Person, Photo, RefereeDesk, RentalArt, Robot, Safe, Stamp, type Mood } from "./Drawings";
import { useT } from "@/lib/i18n/client";
import { baht, dollars, eli5Copy, MONEY, RENTAL, recapLines, type Ending, type Scene } from "./script";
import { clamp01, coinsAt, cue, easeInOut, easeOutBack, has, holdingsAt, pageAt } from "./timeline";

/**
 * The cartoon stage: one SVG (viewBox 1200 x 560) drawn as a pure function of the scene and its clock `t`.
 * Layout: landlord left, the safe in the middle with the KeyEscrow jar beside it, tenant right; the rental, photos,
 * robot and referee appear above when their scene needs them.
 */

const W = 1200;
const H = 560;
const FLOOR = 468;
const LOCKS = [
  { x: 545, y: 322, color: COLORS.landlord, dark: COLORS.landlordDark, rest: { x: 48, y: 330 } },
  { x: 655, y: 322, color: COLORS.tenant, dark: COLORS.tenantDark, rest: { x: 1112, y: 330 } },
];
const PHOTOS = { before: { x: 540, y: 108 }, after: { x: 715, y: 108 } };

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Appear: pop (scale with a little overshoot) or, with reduced motion, fade. */
function Enter({ p, x, y, reduced, children, testId }: { p: number; x: number; y: number; reduced: boolean; children: ReactNode; testId?: string }) {
  if (p <= 0) return null;
  const s = reduced ? 1 : Math.max(0.01, easeOutBack(p));
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={clamp01(p * 1.6)} data-testid={testId}>
      {children}
    </g>
  );
}

function HolderLabel({ x, name, value, show = 1, small }: { x: number; name: string; value: bigint; show?: number; small?: boolean }) {
  if (show <= 0) return null;
  return (
    <g opacity={show} textAnchor="middle">
      <text x={x} y={FLOOR + 30} fontSize={small ? 16 : 19} fontWeight={600} fill="var(--muted)">
        {name}
      </text>
      <text x={x} y={FLOOR + 59} fontSize={small ? 22 : 28} fontWeight={800} fill="var(--foreground)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {baht(value)}
      </text>
      <text x={x} y={FLOOR + 80} fontSize={small ? 13 : 15} fill="var(--subtle)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {dollars(value)}
      </text>
    </g>
  );
}

function Say({ x, y, w, text, tx, ty, think, p, reduced, testId }: { x: number; y: number; w: number; text: string; tx: number; ty: number; think?: boolean; p: number; reduced: boolean; testId?: string }) {
  if (p <= 0) return null;
  return (
    <Enter p={p} x={x} y={y} reduced={reduced} testId={testId}>
      <Bubble w={w} h={54} tx={tx} ty={ty} think={think}>
        <text x={w / 2} y={36} textAnchor="middle" fontSize={23} fontWeight={700} fill="var(--foreground)">
          {text}
        </text>
      </Bubble>
    </Enter>
  );
}

function SplitBubble({ x, y, title, split, p, reduced, tx, ty, testId }: { x: number; y: number; title: string; split: [bigint, bigint]; p: number; reduced: boolean; tx: number; ty: number; testId: string }) {
  const copy = useT().of(eli5Copy);
  return (
    <Enter p={p} x={x} y={y} reduced={reduced} testId={testId}>
      <Bubble w={250} h={112} tx={tx} ty={ty}>
        <text x={18} y={32} fontSize={19} fontWeight={700} fill="var(--muted)">
          {title}
        </text>
        <text x={18} y={64} fontSize={21} fontWeight={800} className="fill-teal-700 dark:fill-teal-300">
          {copy.bubbles.toLandlord(baht(split[0]))}
        </text>
        <text x={18} y={94} fontSize={21} fontWeight={800} className="fill-violet-700 dark:fill-violet-300">
          {copy.bubbles.toTenant(baht(split[1]))}
        </text>
      </Bubble>
    </Enter>
  );
}

export function Stage({ scene, t, reduced, ending }: { scene: Scene; t: number; reduced: boolean; ending: Ending }) {
  const copy = useT().of(eli5Copy);
  const held = holdingsAt(scene, t);
  const c = (name: Parameters<typeof cue>[1], span?: number) => cue(scene, name, t, span);
  const safeShown = c("safe", 600);
  const jarShown = c("jar");

  // Locks: shut on "closed", open on "open". Keys walk into the locks first, except when the safe's own timer opens it.
  const selfOpening = scene.id === "silent" || scene.id === "disagree" || (scene.id === "recap" && ending !== "happy");
  const openP = has(scene, "open") ? c("open", selfOpening ? 700 : 1400) : 0;
  const keyTravel = selfOpening ? 0 : easeInOut(clamp01(openP / 0.55));
  const shackle = has(scene, "open") ? easeInOut(clamp01(selfOpening ? openP : (openP - 0.55) / 0.45)) : has(scene, "closed") ? 1 - easeInOut(c("closed", 260)) : 1;
  const closeAt = scene.cues.closed ?? -1;
  const clickP = closeAt > 0 && t >= closeAt && t < closeAt + 1400 ? 1 : 0;
  const keysOut = c("keys", 900);

  const tenantMood: Mood = scene.id === "problem" && c("worry") > 0 ? "worried" : "happy";
  const landlordMood: Mood =
    has(scene, "sleep") && c("sleep") > 0 ? "sleep" : has(scene, "no") && c("no") > 0 && c("ruling") === 0 ? "cross" : "happy";
  const cheer = reduced ? 0 : c("yes", 500) * (0.6 + 0.4 * Math.sin(t / 180));

  const robotP = c("robot");
  const scanAt = scene.cues.scan;
  const suggestP = c("suggest");
  const bob = reduced ? 0 : Math.sin(t / 380) * 6;
  let glass: { x: number; y: number } | undefined;
  if (has(scene, "scan") || has(scene, "suggest")) {
    const restX = PHOTOS.after.x - 390;
    const restY = PHOTOS.after.y - 170 + 6;
    if (scanAt !== undefined && t >= scanAt && suggestP === 0 && !reduced) {
      const k = (Math.sin(((t - scanAt) / 700) * Math.PI - Math.PI / 2) + 1) / 2;
      glass = { x: lerp(PHOTOS.before.x - 390, restX, k), y: restY };
    } else if (scanAt === undefined || t >= scanAt) glass = { x: restX, y: restY };
  }

  const refP = c("referee");
  const gavelAt = scene.cues.gavel ?? -1;
  const swing = gavelAt > 0 && t >= gavelAt - 500 && !reduced ? Math.abs(Math.sin(clamp01((t - gavelAt + 500) / 900) * Math.PI * 1.5)) : 0;

  const days = scene.calendar ?? [];
  const calPage = scene.id === "rent" ? pageAt(days, t, 3600, 8200) : pageAt(days, t, scene.cues.days ?? 0, scene.cues.open ?? 5000);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={scene.text} data-testid="eli5-stage" preserveAspectRatio="xMidYMid meet">
      {/* floor */}
      <path d={`M20 ${FLOOR + 2} H${W - 20}`} stroke="var(--border-strong)" strokeWidth={4} strokeLinecap="round" />

      {scene.id === "problem" && (
        <g data-testid="eli5-without">
          <rect x={24} y={22} width={230} height={40} rx={20} fill="var(--danger-soft)" stroke="var(--danger-border)" strokeWidth={2} />
          <text x={139} y={49} textAnchor="middle" fontSize={19} fontWeight={700} fill="var(--danger-fg)">
            {copy.bubbles.without}
          </text>
        </g>
      )}

      {/* the rental and the agreement */}
      <Enter p={c("rental")} x={600} y={scene.id === "agree" ? 120 : 150} reduced={reduced}>
        <g transform={scene.id === "agree" ? "scale(0.85)" : "scale(1.05)"}>
          <RentalArt kind={RENTAL.kind} />
        </g>
      </Enter>
      <Enter p={c("agree")} x={850} y={140} reduced={reduced} testId="eli5-paper">
        <Paper title={copy.bubbles.contract} signed={clamp01((t - (scene.cues.agree ?? 0)) / 1400)} />
        <Enter p={clamp01((t - (scene.cues.agree ?? 0) - 1300) / 350)} x={0} y={8} reduced={reduced}>
          <g transform="scale(0.72)">
            <Stamp text={copy.bubbles.agreed} />
          </g>
        </Enter>
      </Enter>

      {/* calendar */}
      {days.length > 0 && (
        <Enter p={c("calendar")} x={scene.id === "rent" ? 860 : 900} y={scene.id === "rent" ? 150 : 128} reduced={reduced} testId="eli5-calendar">
          <Calendar label={days[calPage]} />
        </Enter>
      )}

      {/* photos */}
      <Enter p={c("photos")} x={PHOTOS.before.x} y={PHOTOS.before.y} reduced={reduced} testId="eli5-photos">
        <Photo kind={RENTAL.kind} label={copy.bubbles.before} />
      </Enter>
      <Enter p={has(scene, "photos") ? cue(scene, "photos", t - 500) : 0} x={PHOTOS.after.x} y={PHOTOS.after.y} reduced={reduced}>
        <Photo kind={RENTAL.kind} label={copy.bubbles.after} damage ring={has(scene, "suggest") || has(scene, "ruling") ? Math.max(c("suggest", 700), c("ruling", 700)) : 0} />
      </Enter>

      {/* robot inspector */}
      <Enter p={robotP} x={390} y={170 + bob} reduced={reduced} testId="eli5-robot">
        <Robot glass={glass} />
      </Enter>
      {has(scene, "suggest") && (
        <SplitBubble x={100} y={14} title={copy.bubbles.suggest} split={scene.split!} p={suggestP} reduced={reduced} tx={250} ty={128} testId="eli5-suggest" />
      )}

      {/* referee */}
      <Enter p={refP} x={880} y={FLOOR} reduced={reduced} testId="eli5-referee">
        <g transform="translate(0 -24) scale(0.9)">
          <Person who="referee" mood="neutral" />
        </g>
        <RefereeDesk swing={swing} />
        <text x={0} y={-22} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fde68a">
          {copy.names.referee}
        </text>
      </Enter>
      {has(scene, "ruling") && (
        <SplitBubble x={830} y={14} title={copy.bubbles.rules} split={scene.split!} p={c("ruling")} reduced={reduced} tx={60} ty={198} testId="eli5-ruling" />
      )}

      {/* the jar */}
      <Enter p={jarShown} x={370} y={FLOOR} reduced={reduced} testId="eli5-jar">
        <Jar fill={Number(held.jar) / Number(MONEY.fee) * 0.55} />
      </Enter>
      <HolderLabel x={370} name={copy.names.jar} value={held.jar} show={jarShown} small />

      {/* the safe with two locks */}
      <Enter p={safeShown} x={600} y={FLOOR} reduced={reduced} testId="eli5-safe">
        <Safe fill={Number(held.safe) / Number(MONEY.paidIn)} />
      </Enter>
      {safeShown > 0 &&
        LOCKS.map((l, i) => (
          <Enter key={i} p={c("locks")} x={l.x} y={l.y} reduced={reduced} testId={`eli5-lock-${i === 0 ? "landlord" : "tenant"}`}>
            <g data-open={shackle > 0.5 ? "true" : "false"}>
              <Padlock color={l.color} dark={l.dark} open={shackle} />
            </g>
          </Enter>
        ))}
      {clickP > 0 && (
        <text x={600} y={290} textAnchor="middle" fontSize={24} fontWeight={800} fill={COLORS.goldDark} className="demo-pop" data-testid="eli5-click">
          {copy.bubbles.click}
        </text>
      )}
      <HolderLabel x={600} name={copy.names.safe} value={held.safe} show={safeShown} />

      {/* keys: out to each side, then (on agreement) into the locks */}
      {keysOut > 0 &&
        LOCKS.map((l, i) => {
          const fly = reduced ? 1 : easeInOut(keysOut);
          const x0 = lerp(l.x, l.rest.x, fly);
          const y0 = lerp(l.y, l.rest.y, fly) - (reduced ? 0 : Math.sin(fly * Math.PI) * 80);
          const x = lerp(x0, l.x - 6, keyTravel);
          const y = lerp(y0, l.y, keyTravel);
          return (
            <g key={i} transform={`translate(${x} ${y}) rotate(${keyTravel * 90}) scale(${1 - keyTravel * 0.4})`} opacity={reduced ? keysOut : 1} data-testid="eli5-key">
              <Key color={l.color} />
            </g>
          );
        })}

      {/* the people */}
      <g transform={`translate(150 ${FLOOR})`} data-testid="eli5-landlord">
        <Person who="landlord" mood={landlordMood} wave={cheer} />
      </g>
      <HolderLabel x={150} name={copy.names.landlord} value={held.landlord} />
      <g transform={`translate(1050 ${FLOOR}) scale(-1 1)`} data-testid="eli5-tenant">
        <Person who="tenant" mood={tenantMood} wave={cheer} />
      </g>
      <HolderLabel x={1050} name={copy.names.tenant} value={held.tenant} />

      {/* speech */}
      <Say x={40} y={196} w={210} text={copy.bubbles.grab} tx={110} ty={74} p={c("grab")} reduced={reduced} />
      <Say x={910} y={196} w={270} text={copy.bubbles.worry} tx={140} ty={76} think p={c("worry")} reduced={reduced} testId="eli5-worry" />
      <Say x={50} y={196} w={180} text={copy.bubbles.yes} tx={100} ty={74} p={c("yes")} reduced={reduced} testId="eli5-yes" />
      <Say x={960} y={196} w={180} text={copy.bubbles.yes} tx={90} ty={74} p={c("yes")} reduced={reduced} />
      <Say x={50} y={196} w={180} text={copy.bubbles.no} tx={100} ty={74} p={has(scene, "no") && c("ruling") === 0 ? c("no") : 0} reduced={reduced} testId="eli5-no" />
      <Say x={50} y={196} w={180} text={copy.bubbles.sleep} tx={100} ty={74} think p={c("sleep")} reduced={reduced} testId="eli5-sleep" />

      {/* AGREED stamp over the safe on a happy ending */}
      <Enter p={c("stamp", 380)} x={600} y={232} reduced={reduced} testId="eli5-stamp">
        <Stamp text={copy.bubbles.agreed} />
      </Enter>

      {/* flying coins */}
      {coinsAt(scene, t, reduced).map((k) => (
        <g key={k.key} transform={`translate(${k.x} ${k.y})`} opacity={k.opacity} data-testid="eli5-coin">
          <Coin r={k.r} />
        </g>
      ))}

      {/* recap card */}
      <Enter p={c("recap")} x={600} y={128} reduced={reduced} testId="eli5-recap">
        <RecapCard ending={ending} />
      </Enter>
    </svg>
  );
}

function RecapCard({ ending }: { ending: Ending }) {
  const i18n = useT();
  const copy = i18n.of(eli5Copy);
  const rows = recapLines(ending, i18n.lang);
  return (
    <g>
      <rect x={-300} y={-108} width={600} height={216} rx={22} fill="var(--surface-muted)" stroke="var(--border-strong)" strokeWidth={3} />
      <text x={0} y={-72} textAnchor="middle" fontSize={22} fontWeight={800} fill="var(--foreground)">
        {copy.recapTitle}
      </text>
      {rows.map((r, i) => (
        <g key={r.who} transform={`translate(0 ${-34 + i * 38})`}>
          <text x={-270} y={0} fontSize={20} fontWeight={700} fill="var(--muted)">
            {r.who}
          </text>
          <text x={40} y={0} textAnchor="end" fontSize={22} fontWeight={800} fill="var(--foreground)" style={{ fontVariantNumeric: "tabular-nums" }}>
            {baht(r.value)}
          </text>
          <text x={56} y={0} fontSize={16} fill="var(--subtle)">
            {`${dollars(r.value)} · ${r.note}`}
          </text>
        </g>
      ))}
    </g>
  );
}
