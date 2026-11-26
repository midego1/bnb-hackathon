"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/LogoMark";
import type { LandingCopy } from "./copy";
import { ArrowIcon, PassportIcon, PauseIcon, PersonIcon, PlayIcon, ShopIcon } from "./icons";
import { LED_COLS, LED_ROWS, ledDots } from "./led";

/**
 * One state of the board: what is at each station right now (so the three always add up to what the renter started
 * with, less the fee) and which way the money is moving.
 */
export type FlowFrame = {
  renter: string;
  escrow: string;
  owner: string;
  /** Renter and escrow: "fwd" pays in, "rev" refunds. */
  a?: { dir: "fwd" | "rev"; tag: string };
  /** Escrow to owner. */
  b?: { tag: string };
  fee?: boolean;
};

/**
 * An amount on an LED panel whose dots are BNB coins, as in the artwork (docs/marketing/coins.py): a disc in the
 * station's colour with the official BNB Chain logomark on it. Decorative: the caller prints the same amount as text for
 * screen readers.
 */
function DotNum({ text }: { text: string }) {
  // One coin per 1 x 1 cell; its own id because the coin takes the colour of this panel's station.
  const coin = useId();
  return (
    <svg viewBox={`0 0 ${LED_COLS} ${LED_ROWS}`} className="mk-dotnum" aria-hidden>
      <defs>
        <pattern id={coin} width="1" height="1" patternUnits="userSpaceOnUse">
          <circle cx=".5" cy=".5" r=".45" className="mk-coin" />
          {/* The official file, unchanged: its mark fills a circle of radius .42 around the cell's centre. */}
          <image href="/marketing/bnb-symbol.svg" x=".08" y=".08" width=".84" height=".84" />
        </pattern>
      </defs>
      <rect width={LED_COLS} height={LED_ROWS} fill={`url(#${coin})`} className="mk-dot-off" />
      {/* Keyed by the amount, so the panel "refreshes" (CSS) whenever it changes. Each lit dot is its cell, filled with a coin. */}
      <path key={text} d={ledDots(text).map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")} fill={`url(#${coin})`} className="mk-dot-on" />
    </svg>
  );
}

function Station(p: { tone: "renter" | "escrow" | "owner"; icon: ReactNode; who: string; sub?: string; value: string; label: string; note?: ReactNode; noteOn?: boolean }) {
  return (
    // A station with nothing in it goes dim: only the stations that hold money glow.
    <div className={`mk-station mk-station-${p.tone}`} data-empty={/[1-9]/.test(p.value) ? undefined : ""}>
      <p className="mk-station-who">
        {p.icon}
        <span>
          {p.who}
          {p.sub && <small>{p.sub}</small>}
        </span>
      </p>
      <div className="mk-station-read">
        <DotNum text={p.value} />
        <p>
          <span className="sr-only">{p.value} </span>
          {p.label}
        </p>
      </div>
      {p.note && <p className={`mk-station-note ${p.noteOn === false ? "invisible" : ""}`}>{p.note}</p>}
    </div>
  );
}

/** A row of LED dots between two stations; lit dots chase in the direction the money moves (CSS), under an amount tag. */
function Track({ dir, tag }: { dir?: "fwd" | "rev"; tag?: string }) {
  return (
    <div className="mk-track" data-flow={dir ?? "off"} aria-hidden>
      {tag && (
        <span className="mk-track-tag">
          {tag}
          <ArrowIcon />
        </span>
      )}
    </div>
  );
}

/** How long the autoplay stays on a step; the opening state (nothing has moved yet) gets half of it. */
const STEP_MS = 2600;

/**
 * The page's one moving part: an LED board that follows the example rental's baht from the renter into the escrow, out
 * to the owner and back to the renter. Each panel shows what is at that station now. The server renders the funded
 * state; in the browser the board plays through the four steps once when it scrolls into view (never under reduced
 * motion), and every step is a button.
 */
export function MoneyFlow({
  labels,
  steps,
  frames,
  damageFrame,
  damageBody,
}: {
  labels: LandingCopy["how"]["board"];
  steps: { title: ReactNode; body: string }[];
  frames: FlowFrame[];
  damageFrame: FlowFrame;
  damageBody: string;
}) {
  const [step, setStep] = useState(1);
  const [damage, setDamage] = useState(false);
  const [playing, setPlaying] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  /** False once the visitor has pressed anything: the board then never starts on its own. */
  const auto = useRef(true);
  const last = steps.length - 1;

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        if (!auto.current) return;
        setStep(0);
        setPlaying(true);
      },
      { threshold: 0.6 },
    );
    io.observe(board.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => (step < last ? setStep(step + 1) : setPlaying(false)), step ? STEP_MS : STEP_MS / 2);
    return () => clearTimeout(id);
  }, [playing, step, last]);

  const go = (i: number, withDamage = damage) => {
    auto.current = false;
    setPlaying(false);
    setDamage(withDamage);
    setStep(i);
  };
  const toggle = () => {
    auto.current = false;
    if (!playing && step === last) setStep(0);
    setPlaying(!playing);
  };

  const f = step === last && damage ? damageFrame : frames[step];
  const body = (i: number) => (i === last && damage ? damageBody : steps[i].body);
  // Re-mounts the tracks on every change, so their CSS animations start again.
  const key = `${step}${damage ? "d" : ""}`;
  return (
    <div className="mk-flow" data-testid="mk-flow" data-step={step + 1} data-ending={damage ? "damage" : "clean"}>
      <div ref={board} className="mk-board" role="group" aria-label={labels.label}>
        <Station
          tone="renter"
          icon={<PersonIcon />}
          who={labels.renter}
          value={f.renter}
          label={labels.renterHas}
          note={
            <>
              <PassportIcon />
              {labels.passport}
            </>
          }
        />
        <Track key={`a${key}`} dir={f.a?.dir} tag={f.a?.tag} />
        <Station tone="escrow" icon={<LogoMark className="h-7 w-7 shrink-0" />} who={labels.escrow} sub={labels.escrowSub} value={f.escrow} label={labels.held} />
        <Track key={`b${key}`} dir={f.b && "fwd"} tag={f.b?.tag} />
        <Station tone="owner" icon={<ShopIcon />} who={labels.owner} value={f.owner} label={labels.ownerHas} note={labels.fee} noteOn={!!f.fee} />
      </div>

      <div className="mk-flow-bar">
        <button type="button" className="mk-btn mk-btn-line" onClick={toggle} data-testid="mk-flow-play">
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span className="max-md:sr-only">{playing ? labels.pause : labels.play}</span>
        </button>
        <div role="group" aria-label={labels.ending} className="mk-seg">
          <span aria-hidden className="max-md:hidden">
            {labels.ending}
          </span>
          {[false, true].map((d) => (
            <button key={String(d)} type="button" aria-pressed={step === last && damage === d} onClick={() => go(last, d)} data-testid={d ? "mk-flow-damage" : "mk-flow-clean"}>
              {d ? labels.damage : labels.clean}
            </button>
          ))}
        </div>
      </div>

      <ol className="mk-steps" aria-label={labels.steps}>
        {steps.map((s, i) => (
          <li key={i}>
            <button type="button" aria-current={i === step ? "step" : undefined} onClick={() => go(i)} data-testid={`mk-flow-step-${i + 1}`}>
              <span className="mk-step-n" aria-hidden>
                {i + 1}
              </span>
              <span className="mk-step-title max-md:sr-only">{s.title}</span>
              <span className="mk-step-body">{body(i)}</span>
            </button>
          </li>
        ))}
      </ol>
      {/* Phones show one step at a time here; on wider screens it is only the screen-reader announcement. */}
      <p className="mk-flow-now md:sr-only" aria-live={playing ? "off" : "polite"}>
        <strong>{steps[step].title}</strong>
        <span>{body(step)}</span>
      </p>
    </div>
  );
}
