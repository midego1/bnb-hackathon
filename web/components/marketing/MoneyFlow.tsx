"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LandingCopy } from "./copy";
import { PauseIcon, PlayIcon } from "./icons";
import { MoneyBoard, type FlowFrame } from "./MoneyBoard";

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
      <MoneyBoard ref={board} labels={labels} frame={f} trackKey={key} />

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
