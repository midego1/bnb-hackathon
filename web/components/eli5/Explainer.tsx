"use client";

import Link from "next/link";
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { baht, copy, dollars, ENDINGS, story, type Ending, type Scene } from "./script";
import { Stage } from "./Stage";
import { holdingsAt } from "./timeline";

/**
 * The /how-it-works player: no wallet, no chain, just a clock. A reducer owns (ending, scene, t, playing); the stage
 * draws itself from (scene, t). Space plays / pauses, arrow keys step through scenes, the dots jump.
 *
 * Test hooks (query string, read after mount so the page stays static): ?speed=20 runs the clock 20x, ?ending=,
 * ?scene= (1-based), ?t= (ms into that scene) and ?autoplay=0 start paused at an exact frame for screenshots.
 */

const STORIES: Record<Ending, Scene[]> = { happy: story("happy"), disagree: story("disagree"), silent: story("silent") };
/** The scene where the endings split. */
const BRANCH = STORIES.happy.findIndex((s) => s.id === "happy");

export type ExplainerStart = { ending: Ending; index: number; t: number; playing: boolean; speed: number };
const DEFAULT_START: ExplainerStart = { ending: "happy", index: 0, t: 0, playing: true, speed: 1 };

/** Parse the query string; anything missing or invalid keeps its default. */
export function parseStart(search: string): ExplainerStart {
  const q = new URLSearchParams(search);
  const ending = ENDINGS.find((e) => e.id === q.get("ending"))?.id ?? DEFAULT_START.ending;
  const scenes = STORIES[ending];
  const scene = Number(q.get("scene"));
  const index = Number.isInteger(scene) && scene >= 1 && scene <= scenes.length ? scene - 1 : 0;
  const t = Number(q.get("t"));
  const speed = Number(q.get("speed"));
  return {
    ending,
    index,
    t: Number.isFinite(t) && t > 0 ? Math.min(t, scenes[index].duration) : 0,
    playing: q.get("autoplay") !== "0",
    speed: Number.isFinite(speed) && speed > 0 ? Math.min(speed, 50) : 1,
  };
}

type State = { ending: Ending; index: number; t: number; playing: boolean; speed: number };
type Action =
  | { type: "start"; start: ExplainerStart }
  | { type: "tick"; dt: number }
  | { type: "toggle" }
  | { type: "next" }
  | { type: "back" }
  | { type: "go"; index: number }
  | { type: "ending"; ending: Ending }
  | { type: "replay" };

function reducer(s: State, a: Action): State {
  const scenes = STORIES[s.ending];
  const last = scenes.length - 1;
  const atEnd = s.index === last && s.t >= scenes[last].duration;
  switch (a.type) {
    case "start":
      return { ...a.start };
    case "tick": {
      if (!s.playing) return s;
      const t = s.t + a.dt;
      if (t < scenes[s.index].duration) return { ...s, t };
      if (s.index < last) return { ...s, index: s.index + 1, t: 0 };
      return { ...s, t: scenes[last].duration, playing: false };
    }
    case "toggle":
      if (!s.playing && atEnd) return { ...s, index: 0, t: 0, playing: true };
      return { ...s, playing: !s.playing };
    case "next":
      return s.index < last ? { ...s, index: s.index + 1, t: 0 } : s;
    case "back":
      return { ...s, index: Math.max(0, s.index - 1), t: 0 };
    case "go":
      return { ...s, index: Math.max(0, Math.min(last, a.index)), t: 0 };
    case "ending":
      return s.index >= BRANCH ? { ...s, ending: a.ending, index: BRANCH, t: 0, playing: true } : { ...s, ending: a.ending };
    case "replay":
      return { ...s, index: 0, t: 0, playing: true };
  }
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(motionQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(motionQuery).matches,
    () => false,
  );
}

export function Explainer({ realDemo }: { realDemo: boolean }) {
  const [s, dispatch] = useReducer(reducer, DEFAULT_START);
  const reduced = useReducedMotion();
  const scenes = STORIES[s.ending];
  const scene = scenes[s.index];
  const last = scenes.length - 1;
  const done = s.index === last && s.t >= scene.duration;

  // Query-string start (tests, screenshots, shared links), applied once after hydration.
  useEffect(() => {
    if (window.location.search) dispatch({ type: "start", start: parseStart(window.location.search) });
  }, []);

  // The clock.
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

  // Keyboard: space = play / pause (also when a control has focus), arrows = scenes.
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

  const held = holdingsAt(scene, s.t);

  return (
    <div
      className="flex flex-col gap-3 stage:min-h-0 stage:flex-1"
      data-testid="eli5"
      data-scene={scene.id}
      data-index={s.index}
      data-ending={s.ending}
      data-playing={s.playing ? "true" : "false"}
      data-done={done ? "true" : "false"}
      data-motion={reduced ? "reduced" : "full"}
    >
      {/* Title row: what this is, the ending picker, the way to the real thing. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{copy.heading}</h1>
        <div className="flex items-center gap-2" role="radiogroup" aria-label={copy.ending}>
          <span className="text-sm font-medium text-subtle">{copy.ending}</span>
          <div className="inline-flex rounded-xl border border-border-strong bg-surface p-0.5">
            {ENDINGS.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={s.ending === e.id}
                onClick={() => dispatch({ type: "ending", ending: e.id })}
                data-testid={`eli5-ending-${e.id}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${s.ending === e.id ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-muted"}`}
              >
                <span aria-hidden>{e.short}</span> {e.label}
              </button>
            ))}
          </div>
        </div>
        <Link
          href={realDemo ? "/demo" : "/landlord"}
          className="text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline lg:ml-auto"
          data-testid="eli5-real"
        >
          {realDemo ? copy.realDemo : copy.tryIt}
        </Link>
      </div>

      {/* The cartoon. */}
      <div className="relative aspect-[1200/560] w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm stage:aspect-auto stage:min-h-0 stage:flex-1" data-testid="eli5-cartoon">
        <div className="absolute inset-0 p-2">
          <Stage scene={scene} t={s.t} reduced={reduced} ending={s.ending} />
        </div>
      </div>

      {/* Phones: the amounts again, big enough to read. */}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:hidden" data-testid="eli5-balances">
        {(["tenant", "landlord", "safe", "jar"] as const).map((h) => (
          <div key={h} className="rounded-xl border border-border bg-surface px-3 py-2">
            <dt className="text-subtle">{copy.names[h]}</dt>
            <dd className="font-semibold tabular-nums">
              {baht(held[h])} <span className="text-xs font-normal text-subtle">{dollars(held[h])}</span>
            </dd>
          </div>
        ))}
      </dl>

      {/* Narration + controls. */}
      <div className="grid shrink-0 gap-3 rounded-2xl border border-border bg-surface px-5 py-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div key={`${s.ending}-${scene.id}`} className="demo-pop min-w-0" data-testid="eli5-narration" aria-live="polite">
          <p className="text-xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl tall:text-[2.1rem]">{scene.text}</p>
          <p className="mt-1.5 text-sm text-subtle">
            <span className="font-medium text-muted">{copy.grownUp}:</span> {scene.detail}
          </p>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => dispatch({ type: "back" })} disabled={s.index === 0} className={secondaryBtn} data-testid="eli5-back" aria-label={copy.back}>
              ◀ {copy.back}
            </button>
            {done ? (
              <button type="button" onClick={() => dispatch({ type: "replay" })} className={primaryBtn} data-testid="eli5-replay">
                ↺ {copy.replay}
              </button>
            ) : (
              <button type="button" onClick={() => dispatch({ type: "toggle" })} className={primaryBtn} data-testid="eli5-play" aria-pressed={s.playing}>
                {s.playing ? `❚❚ ${copy.pause}` : `▶ ${copy.play}`}
              </button>
            )}
            <button type="button" onClick={() => dispatch({ type: "next" })} disabled={s.index === last} className={secondaryBtn} data-testid="eli5-next" aria-label={copy.next}>
              {copy.next} ▶
            </button>
          </div>
          <div className="flex items-center gap-3">
            <ol className="flex items-center gap-1.5" aria-label={copy.sceneOf(s.index + 1, scenes.length)} data-testid="eli5-dots">
              {scenes.map((x, i) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "go", index: i })}
                    aria-label={copy.goTo(i + 1)}
                    aria-current={i === s.index ? "step" : undefined}
                    data-testid="eli5-dot"
                    className={`relative block h-3 overflow-hidden rounded-full transition-all ${i === s.index ? "w-10 bg-surface-strong" : i < s.index ? "w-3 bg-amber-400" : "w-3 bg-surface-strong hover:bg-border-hover"}`}
                  >
                    {i === s.index && <span className="absolute inset-y-0 left-0 bg-amber-400" style={{ width: `${Math.min(100, (s.t / x.duration) * 100)}%` }} />}
                  </button>
                </li>
              ))}
            </ol>
            <span className="text-xs whitespace-nowrap text-subtle tabular-nums">{copy.sceneOf(s.index + 1, scenes.length)}</span>
          </div>
          <span className="hidden text-xs text-subtle lg:block">{copy.keys}</span>
        </div>
      </div>
    </div>
  );
}

const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border-strong bg-surface px-4 py-2 text-base font-medium hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40";
const primaryBtn =
  "inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-2 text-base font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300";
