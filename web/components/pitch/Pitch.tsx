"use client";

import { useEffect, useReducer } from "react";
import { useReducedMotion } from "@/components/eli5/Explainer";
import { BUDGET_S, mmss, pitchCopy as copy, SCENES } from "./script";
import { PitchStage } from "./Stage";

/**
 * The /pitch player, the /how-it-works player (components/eli5/Explainer.tsx) for one linear story: a reducer owns
 * (scene, t, playing), the stage draws itself from (scene, t). Space plays / pauses, arrows step, the dots jump.
 * Test hooks like /how-it-works: ?speed=, ?scene= (1-based), ?t= (ms into that scene), ?autoplay=0.
 */

type State = { index: number; t: number; playing: boolean; speed: number };
type Action = { type: "start"; start: State } | { type: "tick"; dt: number } | { type: "toggle" } | { type: "next" } | { type: "back" } | { type: "go"; index: number };

const LAST = SCENES.length - 1;
const DEFAULT: State = { index: 0, t: 0, playing: true, speed: 1 };

export function parsePitchStart(search: string): State {
  const q = new URLSearchParams(search);
  const scene = Number(q.get("scene"));
  const index = Number.isInteger(scene) && scene >= 1 && scene <= SCENES.length ? scene - 1 : 0;
  const t = Number(q.get("t"));
  const speed = Number(q.get("speed"));
  return {
    index,
    t: Number.isFinite(t) && t > 0 ? Math.min(t, SCENES[index].duration) : 0,
    playing: q.get("autoplay") !== "0",
    speed: Number.isFinite(speed) && speed > 0 ? Math.min(speed, 100) : 1,
  };
}

export function pitchReducer(s: State, a: Action): State {
  const atEnd = s.index === LAST && s.t >= SCENES[LAST].duration;
  switch (a.type) {
    case "start":
      return { ...a.start };
    case "tick": {
      if (!s.playing) return s;
      const t = s.t + a.dt;
      if (t < SCENES[s.index].duration) return { ...s, t };
      if (s.index < LAST) return { ...s, index: s.index + 1, t: 0 };
      return { ...s, t: SCENES[LAST].duration, playing: false };
    }
    case "toggle":
      return !s.playing && atEnd ? { ...s, index: 0, t: 0, playing: true } : { ...s, playing: !s.playing };
    case "next":
      return s.index < LAST ? { ...s, index: s.index + 1, t: 0 } : s;
    case "back":
      return { ...s, index: Math.max(0, s.index - 1), t: 0 };
    case "go":
      return { ...s, index: Math.max(0, Math.min(LAST, a.index)), t: 0 };
  }
}

export function Pitch() {
  const [s, dispatch] = useReducer(pitchReducer, DEFAULT);
  const reduced = useReducedMotion();
  const scene = SCENES[s.index];
  const done = s.index === LAST && s.t >= scene.duration;
  const elapsed = Math.min(BUDGET_S, scene.at + s.t / 1000);

  useEffect(() => {
    if (window.location.search) dispatch({ type: "start", start: parsePitchStart(window.location.search) });
  }, []);

  useEffect(() => {
    if (!s.playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      dispatch({ type: "tick", dt: Math.min(100, now - prev) * s.speed });
      prev = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.playing, s.speed]);

  // Same keys as /how-it-works (and a presenter clicker): space = play / pause, arrows = scenes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (e.type === "keydown" && !e.repeat) dispatch({ type: "toggle" });
      } else if (e.type === "keydown" && e.key === "ArrowRight") dispatch({ type: "next" });
      else if (e.type === "keydown" && e.key === "ArrowLeft") dispatch({ type: "back" });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey); // a focused button would otherwise "click" on space-up
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  return (
    <div
      className="flex flex-col gap-3 stage:min-h-0 stage:flex-1"
      data-testid="pitch"
      data-scene={scene.id}
      data-index={s.index}
      data-playing={s.playing ? "true" : "false"}
      data-done={done ? "true" : "false"}
      data-motion={reduced ? "reduced" : "full"}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{copy.heading}</h1>
        <span className="text-sm text-subtle">{copy.sub}</span>
      </div>

      <div className="relative aspect-[1200/560] w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm stage:aspect-auto stage:min-h-0 stage:flex-1" data-testid="pitch-cartoon">
        <div className="absolute inset-0 p-2">
          <PitchStage scene={scene} t={s.t} reduced={reduced} />
        </div>
      </div>

      <div className="grid shrink-0 gap-3 rounded-2xl border border-border bg-surface px-5 py-3 shadow-sm">
        {/* The 3:00 budget, with every scene's time mark. */}
        <div className="flex items-center gap-3" data-testid="pitch-timer">
          <div className="relative h-2.5 flex-1 rounded-full bg-surface-strong" role="progressbar" aria-label={copy.budget} aria-valuemin={0} aria-valuemax={BUDGET_S} aria-valuenow={Math.round(elapsed)} aria-valuetext={`${mmss(elapsed)} / ${mmss(BUDGET_S)}`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-amber-400" style={{ width: `${(elapsed / BUDGET_S) * 100}%` }} />
            {SCENES.slice(1, -1).map((x) => (
              <span key={x.id} className="absolute inset-y-0 w-0.5 bg-surface" style={{ left: `${(x.at / BUDGET_S) * 100}%` }} />
            ))}
          </div>
          <span className="w-24 text-right text-sm font-semibold tabular-nums" data-testid="pitch-clock">
            {mmss(elapsed)} / {mmss(BUDGET_S)}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div key={scene.id} className="demo-pop min-w-0" data-testid="pitch-narration" aria-live="polite">
            <p className="text-xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl tall:text-[2.1rem]">{scene.text}</p>
            <p className="mt-1.5 text-sm text-subtle" data-testid="pitch-note">
              <span className="font-semibold text-muted tabular-nums">{mmss(scene.at)}</span> · {scene.note}
            </p>
          </div>

          <div className="flex flex-col gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => dispatch({ type: "back" })} disabled={s.index === 0} className={secondaryBtn} data-testid="pitch-back" aria-label={copy.back}>
                ◀ {copy.back}
              </button>
              <button type="button" onClick={() => dispatch({ type: "toggle" })} className={primaryBtn} data-testid="pitch-play" aria-pressed={s.playing}>
                {done ? `↺ ${copy.replay}` : s.playing ? `❚❚ ${copy.pause}` : `▶ ${copy.play}`}
              </button>
              <button type="button" onClick={() => dispatch({ type: "next" })} disabled={s.index === LAST} className={secondaryBtn} data-testid="pitch-next" aria-label={copy.next}>
                {copy.next} ▶
              </button>
            </div>
            <div className="flex items-center gap-3">
              <ol className="flex items-center gap-1" aria-label={copy.sceneOf(s.index + 1, SCENES.length)}>
                {SCENES.map((x, i) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "go", index: i })}
                      aria-label={copy.goTo(i + 1, mmss(x.at))}
                      aria-current={i === s.index ? "step" : undefined}
                      data-testid="pitch-dot"
                      className={`relative block h-3 overflow-hidden rounded-full transition-all ${i === s.index ? "w-8 bg-surface-strong" : i < s.index ? "w-3 bg-amber-400" : "w-3 bg-surface-strong hover:bg-border-hover"}`}
                    >
                      {i === s.index && <span className="absolute inset-y-0 left-0 bg-amber-400" style={{ width: `${Math.min(100, (s.t / x.duration) * 100)}%` }} />}
                    </button>
                  </li>
                ))}
              </ol>
              <span className="text-xs whitespace-nowrap text-subtle tabular-nums">{copy.sceneOf(s.index + 1, SCENES.length)}</span>
            </div>
            <span className="hidden text-xs text-subtle lg:block">{copy.keys}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border-strong bg-surface px-4 py-2 text-base font-medium hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40";
const primaryBtn =
  "inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-2 text-base font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300";
