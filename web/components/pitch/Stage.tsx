import { Bubble, Coin, COLORS, INK, Jar, Padlock, Person, RentalArt, Robot, Safe } from "@/components/eli5/Drawings";
import { baht } from "@/components/eli5/script";
import { Enter, FLOOR, HolderLabel, Say } from "@/components/eli5/Stage";
import { clamp01, coinsAt, cue, easeInOut, has, holdingsAt } from "@/components/eli5/timeline";
import { BigScreen, MysteryBox, Passport, Phone, Pointer, Qr } from "./Drawings";
import { PITCH_MONEY, pitchCopy as copy, type PitchCue, type PitchScene } from "./script";

/**
 * The /pitch stage: one SVG (viewBox 1200 x 560, the /how-it-works stage) drawn from (scene, t). Us left, the judge
 * right, the box's safe in the middle with the big screen above it; the Mystery Box travels between us and the judge.
 */

const W = 1200;
const H = 560;
const SCREEN = { x: 600, y: 16, w: 520, h: 214 };
const LOCKS = [
  { x: 545, color: COLORS.landlord, dark: COLORS.landlordDark },
  { x: 655, color: COLORS.tenant, dark: COLORS.tenantDark },
];
const BOX = { us: 282, judge: 890 };
const JUDGE_X = 1050;
const SHOP_X = 150;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Where the judge's raised hand is, for the phone: the ELI5 person's waving arm, mirrored. */
function judgeHand(wave: number) {
  const a = ((-8 - wave * 120) * Math.PI) / 180;
  return { x: JUDGE_X - (45 - 62 * Math.sin(a)), y: FLOOR - 118 + 62 * Math.cos(a) };
}

export function PitchStage({ scene, t, reduced }: { scene: PitchScene; t: number; reduced: boolean }) {
  const c = (name: PitchCue, span?: number) => cue<PitchCue>(scene, name, t, span);
  const on = (name: PitchCue) => has<PitchCue>(scene, name);
  const held = holdingsAt(scene, t);
  const problem = scene.id === "problem";

  const shackle = on("open") ? easeInOut(c("open", 900)) : on("closed") ? 1 - easeInOut(c("closed", 260)) : 1;
  const closeAt = scene.cues.closed ?? -1;
  const click = closeAt > 0 && t >= closeAt && t < closeAt + 1400;

  const phone = c("phone");
  const wave = 0.75 * phone;
  const hand = judgeHand(wave);
  const flashes = scene.flashes ?? [];
  const shots = flashes.filter((f) => t >= f).length;
  const flash = Math.max(0, ...flashes.map((f) => (t >= f && t < f + 400 ? 1 - (t - f) / 400 : 0)));
  const phoneLabel = flashes.length ? copy.bubbles.photos(shots) : scene.id === "qr" ? (c("scan") > 0 ? "✓" : "📷") : "✓";

  const boxX = on("pickup") ? lerp(BOX.us, BOX.judge, easeInOut(c("pickup", 1600))) : on("return") ? lerp(BOX.judge, BOX.us, easeInOut(c("return", 1600))) : BOX.us;
  const boxHop = reduced ? 0 : Math.sin(Math.PI * (on("pickup") ? c("pickup", 1600) : on("return") ? c("return", 1600) : 0)) * 70;

  const bob = reduced ? 0 : Math.sin(t / 380) * 6;
  const qrP = c("qr");
  const bscAt = scene.cues.bscscan ?? -1;
  const bscPulse = bscAt > 0 && t >= bscAt ? (reduced ? 1 : 0.65 + 0.35 * Math.sin((t - bscAt) / 160)) : 0;

  // Passport: from the tourist's hand to the shop, in an arc.
  const pp = c("passport", 1400);
  const pe = easeInOut(pp);
  const passport = { x: lerp(JUDGE_X - 60, SHOP_X + 60, pe), y: 360 - (reduced ? 0 : Math.sin(pe * Math.PI) * 140) };

  const accept = c("accept", 300);
  const acceptAt = scene.cues.accept ?? -1;
  const pointer = acceptAt > 0 ? clamp01((t - (acceptAt - 1200)) / 1100) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={scene.text} data-testid="pitch-stage" preserveAspectRatio="xMidYMid meet">
      <path d={`M20 ${FLOOR + 2} H${W - 20}`} stroke="var(--border-strong)" strokeWidth={4} strokeLinecap="round" />

      {/* the problem: a scooter */}
      <Enter p={c("scooter")} x={600} y={160} reduced={reduced}>
        <g transform="scale(1.1)">
          <RentalArt kind="scooter" />
        </g>
      </Enter>

      {/* the big screen */}
      <Enter p={c("screen", 600)} x={SCREEN.x} y={SCREEN.y} reduced={reduced} testId="pitch-screen">
        <BigScreen w={SCREEN.w} h={SCREEN.h}>
          <ScreenContent scene={scene} qr={qrP} reduced={reduced} accept={accept} bscPulse={bscPulse} chips={(i) => c("chips") > 0 ? clamp01((t - (scene.cues.chips ?? 0) - i * 900) / 400) : 1} />
        </BigScreen>
      </Enter>
      {pointer > 0 && (
        <g transform={`translate(${lerp(860, 600, easeInOut(pointer))} ${lerp(300, SCREEN.y + 168, easeInOut(pointer))}) scale(${accept > 0 && accept < 1 ? 0.85 : 1})`} data-testid="pitch-pointer">
          <Pointer />
        </g>
      )}

      {/* scan beam: phone to QR */}
      {c("scan") > 0 && (
        <path
          d={`M${hand.x} ${hand.y - 20} L${SCREEN.x - 160} ${SCREEN.y + 110}`}
          stroke="#22d3ee"
          strokeWidth={4}
          strokeDasharray="10 10"
          strokeDashoffset={reduced ? 0 : -t / 20}
          opacity={0.85 * c("scan")}
          data-testid="pitch-scan"
        />
      )}

      {/* the robot */}
      <Enter p={c("robot")} x={250} y={200 + bob} reduced={reduced} testId="pitch-robot">
        <Robot />
      </Enter>
      {on("suggest") && (
        <Enter p={c("suggest")} x={14} y={8} reduced={reduced} testId="pitch-suggest">
          <Bubble w={250} h={108} tx={226} ty={120}>
            <text x={18} y={32} fontSize={19} fontWeight={700} fill="var(--muted)">
              {copy.bubbles.suggest}
            </text>
            <text x={18} y={62} fontSize={21} fontWeight={800} className="fill-teal-700 dark:fill-teal-300">
              {copy.bubbles.toUs(baht(PITCH_MONEY.repair))}
            </text>
            <text x={18} y={92} fontSize={21} fontWeight={800} className="fill-violet-700 dark:fill-violet-300">
              {copy.bubbles.toJudge(baht(PITCH_MONEY.refund))}
            </text>
          </Bubble>
        </Enter>
      )}

      {/* the jar */}
      <Enter p={c("jar")} x={380} y={FLOOR} reduced={reduced} testId="pitch-jar">
        <Jar fill={(Number(held.jar) / Number(PITCH_MONEY.fee)) * 0.55} />
      </Enter>
      {on("jar") && <HolderLabel x={380} name={copy.names.jar} value={held.jar} show={c("jar")} small />}

      {/* the box's own safe */}
      <Enter p={c("safe", 600)} x={600} y={FLOOR} reduced={reduced} testId="pitch-safe">
        <Safe fill={Number(held.safe) / Number(PITCH_MONEY.paidIn)} />
      </Enter>
      {c("safe") > 0 &&
        LOCKS.map((l, i) => (
          <Enter key={i} p={c("locks")} x={l.x} y={322} reduced={reduced} testId={`pitch-lock-${i}`}>
            <g data-open={shackle > 0.5 ? "true" : "false"}>
              <Padlock color={l.color} dark={l.dark} open={shackle} />
            </g>
          </Enter>
        ))}
      {click && (
        <text x={600} y={290} textAnchor="middle" fontSize={24} fontWeight={800} fill={COLORS.goldDark} className="demo-pop">
          {copy.bubbles.click}
        </text>
      )}
      {on("safe") && <HolderLabel x={600} name={copy.names.safe} value={held.safe} show={c("safe")} />}

      {/* the Mystery Box */}
      <Enter p={c("box")} x={boxX} y={FLOOR - boxHop} reduced={reduced} testId="pitch-box">
        <g data-x={Math.round(boxX)}>
          <MysteryBox mark={copy.bubbles.box} scuff={on("scuff")} />
        </g>
      </Enter>

      {/* the people */}
      <g transform={`translate(${SHOP_X} ${FLOOR})`} data-testid="pitch-us">
        <Person who="landlord" />
      </g>
      <g transform={`translate(${JUDGE_X} ${FLOOR}) scale(-1 1)`} data-testid="pitch-judge">
        <Person who="tenant" mood={problem && c("worry") > 0 ? "worried" : "happy"} wave={wave} />
        {!problem && (
          <g transform="scale(-1 1)">
            <path d="M-14 -126 L0 -98 L14 -126" fill="none" stroke="#2563eb" strokeWidth={3} />
            <rect x={-22} y={-100} width={44} height={20} rx={4} fill="#fff" stroke={INK} strokeWidth={2} />
            <text y={-85} textAnchor="middle" fontSize={11} fontWeight={800} fill="#1e3a8a">
              JUDGE
            </text>
          </g>
        )}
      </g>
      {problem ? (
        <g textAnchor="middle" fontSize={19} fontWeight={600} fill="var(--muted)">
          <text x={SHOP_X} y={FLOOR + 30}>{copy.names.shop}</text>
          <text x={JUDGE_X} y={FLOOR + 30}>{copy.names.tourist}</text>
        </g>
      ) : (
        <>
          <HolderLabel x={SHOP_X} name={copy.names.landlord} value={held.landlord} />
          <HolderLabel x={JUDGE_X} name={copy.names.tenant} value={held.tenant} />
        </>
      )}

      {/* the passport, in front of the people */}
      {on("passport") && (
        <g transform={`translate(${passport.x} ${passport.y}) rotate(${reduced ? 0 : pe * -20})`} data-testid="pitch-passport">
          <Passport label={copy.bubbles.passport} />
        </g>
      )}
      {/* the judge's phone */}
      {phone > 0 && (
        <g transform={`translate(${hand.x} ${hand.y - 26})`} opacity={phone} data-testid="pitch-phone" data-shots={shots}>
          {flash > 0 && <circle r={70} fill="#fff" opacity={flash * 0.9} data-testid="pitch-flash" />}
          <Phone label={phoneLabel} />
        </g>
      )}

      {/* speech */}
      <Say x={40} y={170} w={190} text={copy.bubbles.grab} tx={110} ty={100} p={c("grab")} reduced={reduced} />
      <Say x={900} y={170} w={250} text={copy.bubbles.worry} tx={150} ty={100} think p={c("worry")} reduced={reduced} testId="pitch-worry" />

      {/* coins */}
      {coinsAt(scene, t, reduced).map((k) => (
        <g key={k.key} transform={`translate(${k.x} ${k.y})`} opacity={k.opacity} data-testid="pitch-coin">
          <Coin r={k.r} />
        </g>
      ))}
    </svg>
  );
}

function ScreenContent({ scene, qr, reduced, accept, bscPulse, chips }: { scene: PitchScene; qr: number; reduced: boolean; accept: number; bscPulse: number; chips: (i: number) => number }) {
  const s = scene.screen;
  if (!s) return null;
  const lines = s.lines ?? [];
  if (scene.id === "qr")
    return (
      <g>
        <Enter p={qr} x={-SCREEN.w / 2 + 40} y={30} reduced={reduced} testId="pitch-qr">
          <Qr size={154} />
        </Enter>
        <text x={-40} y={100} fontSize={26} fontWeight={800} fill="#fff">
          {s.title}
        </text>
        <text x={-40} y={142} fontSize={22} fontWeight={600} fill="#fbbf24" opacity={qr}>
          {copy.bubbles.scan} →
        </text>
      </g>
    );
  if (scene.id === "settle") {
    const done = accept >= 1;
    return (
      <g>
        <text y={52} textAnchor="middle" fontSize={30} fontWeight={800} fill="#fff">
          {s.title}
        </text>
        <text y={96} textAnchor="middle" fontSize={21} fontWeight={600} fill="#cbd5e1">
          {`${copy.bubbles.toUs(baht(PITCH_MONEY.repair))} · ${copy.bubbles.toJudge(baht(PITCH_MONEY.refund))}`}
        </text>
        <g data-testid="pitch-accept" data-accepted={done ? "true" : "false"}>
          <rect x={-90} y={130} width={180} height={54} rx={12} fill={done ? "#059669" : "#10b981"} stroke="#fff" strokeWidth={done ? 0 : 2} />
          <text y={165} textAnchor="middle" fontSize={23} fontWeight={800} fill="#fff">
            {done ? copy.bubbles.accepted : copy.bubbles.accept}
          </text>
        </g>
      </g>
    );
  }
  const chipped = scene.cues.chips !== undefined;
  return (
    <g>
      <text y={lines.length > 2 ? 50 : 62} textAnchor="middle" fontSize={32} fontWeight={800} fill="#fff">
        {s.title}
      </text>
      {lines.map((l, i) =>
        chipped ? (
          <g key={l} opacity={chips(i)} transform={`translate(0 ${70 + i * 46})`}>
            <rect x={-230} y={0} width={460} height={38} rx={19} fill="#1e293b" stroke="#fbbf24" strokeWidth={2} />
            <text y={26} textAnchor="middle" fontSize={20} fontWeight={700} fill="#fde68a">
              {l}
            </text>
          </g>
        ) : (
          <text key={l} y={110 + i * 36} textAnchor="middle" fontSize={23} fontWeight={600} fill="#cbd5e1">
            {l}
          </text>
        ),
      )}
      {bscPulse > 0 && (
        <g opacity={bscPulse} data-testid="pitch-bscscan">
          <rect x={-130} y={166} width={260} height={36} rx={18} fill="#f0b90b" />
          <text y={190} textAnchor="middle" fontSize={18} fontWeight={800} fill="#0f172a">
            {copy.bubbles.bscscan}
          </text>
        </g>
      )}
    </g>
  );
}
