"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Spinner } from "@/components/Toasts";
import type { Activity, Beat, Pacer } from "@/lib/demo/pacing";
import type { DemoPath, DemoStep } from "@/lib/demo/script";
import { PATHS } from "@/lib/demo/script";
import { tone } from "./ActorBoard";
import { actorCards, actorLabel, guidedCopy, panels } from "./copy";

/**
 * The narration card of Guided speed: the intro card before step 1, then three beats per step ("What happens now",
 * "On-chain now" with one line per transaction, "What just changed"). A thin bar shows how long until it moves on;
 * Back / Next move through the captions. Holds no copy of its own (components/demo/copy.ts, lib/demo/explain.ts).
 */

export type BeatNav = { canBack: boolean; onBack: () => void; onNext: () => void; reviewing: boolean };

const card =
  "shrink-0 rounded-2xl border border-warning-border bg-warning-soft px-5 py-4 text-warning-fg stage:min-h-0 stage:shrink stage:overflow-y-auto xl:tall:px-6 xl:tall:py-5";
const STEP_BEATS: Exclude<Beat, "intro">[] = ["now", "run", "changed"];

export function GuidedIntro({ path, pacer, nav }: { path: DemoPath; pacer: Pacer | null; nav: BeatNav }) {
  const c = guidedCopy.intro;
  const cast = ["tenant", "landlord", "escrow", "treasury", "arbiter", "inspector"] as const;
  return (
    <section className={card} data-testid="demo-narration" data-beat="intro" aria-live="polite">
      <Header>
        <BeatChip active>{guidedCopy.beat.intro}</BeatChip>
      </Header>
      {nav.reviewing && <Reviewing />}
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight xl:tall:text-3xl">{c.title}</h2>
      <p className="mt-1.5 text-base leading-relaxed tall:text-lg xl:tall:text-xl xl:tall:leading-relaxed">{c.body}</p>
      <h3 className="mt-3 text-sm font-semibold uppercase tracking-wide opacity-70">{c.cast}</h3>
      <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 xl:tall:grid-cols-3" data-testid="demo-cast">
        {cast.map((k) => (
          <li key={k} className="flex min-w-0 items-baseline gap-2 text-sm leading-snug tall:text-base">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full ${tone[k]}`} />
            <span className="min-w-0">
              <span className="font-semibold">{actorCards[k].name}</span> <span className="opacity-80">{actorCards[k].note}</span>
            </span>
          </li>
        ))}
      </ul>
      <h3 className="mt-3 text-sm font-semibold uppercase tracking-wide opacity-70">{c.see}</h3>
      <p className="mt-0.5 text-base leading-relaxed tall:text-lg">
        <span className="font-semibold">{PATHS[path].label}:</span> {PATHS[path].blurb} {c.beats}
      </p>
      <Footer pacer={pacer} nav={nav} />
    </section>
  );
}

export function GuidedStep({
  step,
  index,
  total,
  beat,
  actorTone,
  now,
  changed,
  activities,
  flow,
  pacer,
  nav,
}: {
  step: DemoStep;
  index: number;
  total: number;
  beat: Exclude<Beat, "intro">;
  actorTone: string;
  now: string;
  changed: string;
  activities: Activity[];
  flow: ReactNode;
  pacer: Pacer | null;
  nav: BeatNav;
}) {
  return (
    <section className={card} data-testid="demo-narration" data-beat={beat} aria-live="polite">
      <Header>
        <span className="font-semibold uppercase tracking-wide opacity-70">{panels.stepOf(index + 1, total)}</span>
        <span className={`rounded-full px-2.5 py-0.5 font-semibold ${actorTone}`}>{actorLabel[step.actor]}</span>
        {step.demoOnly && <span className="rounded-full bg-amber-300 px-2.5 py-0.5 font-semibold text-amber-950 dark:bg-amber-400">{step.demoOnly}</span>}
        <span className="ml-auto flex flex-wrap gap-1" data-testid="demo-beats">
          {STEP_BEATS.map((b, i) => (
            <BeatChip key={b} active={b === beat}>
              {i + 1} {guidedCopy.beat[b]}
            </BeatChip>
          ))}
        </span>
      </Header>
      {nav.reviewing && <Reviewing />}
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight xl:tall:text-3xl">{step.title}</h2>

      {beat === "changed" ? (
        <>
          <div className="mt-2 rounded-xl border-2 border-success-border bg-success-soft px-3 py-2 text-success-fg" data-testid="demo-changed-flow">
            {flow}
          </div>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide opacity-70">{guidedCopy.why}</p>
          <p className="mt-0.5 text-lg leading-relaxed xl:text-xl xl:leading-relaxed" data-testid="demo-changed">
            {changed}
          </p>
        </>
      ) : (
        <p
          className={`mt-1.5 leading-relaxed ${beat === "run" ? "text-base opacity-80 xl:text-lg" : "text-lg xl:text-xl xl:leading-relaxed"}`}
          data-testid="demo-now"
        >
          {now}
        </p>
      )}

      {beat === "run" && <ActivityList activities={activities} />}
      <Footer pacer={pacer} nav={nav} />
    </section>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>;
}

function BeatChip({ active, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      data-active={active ? "true" : "false"}
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold ${
        active ? "bg-amber-400 text-amber-950 dark:bg-amber-400 dark:text-amber-950" : "bg-surface/60 opacity-60"
      }`}
    >
      {children}
    </span>
  );
}

function Reviewing() {
  return (
    <p className="mt-1.5 rounded-lg bg-surface/70 px-2.5 py-1 text-sm font-medium" data-testid="demo-reviewing">
      {guidedCopy.reviewing}
    </p>
  );
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function ActivityList({ activities }: { activities: Activity[] }) {
  return (
    <ul className="mt-3 space-y-1.5 border-t border-warning-border pt-2.5" data-testid="demo-activities">
      {activities.length === 0 && (
        <li className="flex items-center gap-2 text-base opacity-80">
          <Spinner /> {guidedCopy.nothingYet}
        </li>
      )}
      {activities.map((a) => (
        <li key={a.id} className="flex items-start gap-2 text-base leading-snug" data-testid="demo-activity" data-status={a.status} data-kind={a.kind}>
          <span className="mt-0.5 inline-flex w-5 shrink-0 justify-center" aria-hidden>
            {a.status === "running" ? <Spinner /> : a.status === "done" ? <span className="font-bold text-success">✓</span> : <span className="font-bold text-danger">✗</span>}
          </span>
          <span className="min-w-0">
            {a.kind === "tx" ? (
              <>
                {a.role && <span className="font-semibold">{guidedCopy.signing(actorLabel[a.role])} → </span>}
                <span className="break-all font-mono text-[15px]">{guidedCopy.calling(a.contract, a.fn, a.args)}</span>
                {a.hash && (
                  <span className="ml-2 whitespace-nowrap font-mono text-sm opacity-80" data-testid="demo-activity-hash" title={a.hash}>
                    {guidedCopy.confirmed} {short(a.hash)}
                  </span>
                )}
              </>
            ) : a.kind === "upload" ? (
              guidedCopy.upload(a.count)
            ) : a.kind === "inspect" ? (
              guidedCopy.inspect
            ) : (
              guidedCopy.time(a.seconds)
            )}
            {a.status === "error" && <span className="ml-2 font-semibold text-danger">{guidedCopy.failed}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Footer({ pacer, nav }: { pacer: Pacer | null; nav: BeatNav }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">{pacer && !nav.reviewing && <BeatBar pacer={pacer} />}</div>
      <span className="hidden text-xs opacity-60 xl:tall:inline">{guidedCopy.keys}</span>
      <button
        type="button"
        onClick={nav.onBack}
        disabled={!nav.canBack}
        data-testid="demo-beat-back"
        className="inline-flex min-h-9 items-center rounded-lg border border-warning-border bg-surface/70 px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        {guidedCopy.back}
      </button>
      <button
        type="button"
        onClick={nav.onNext}
        data-testid="demo-beat-next"
        className="inline-flex min-h-9 items-center rounded-lg bg-amber-400 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
      >
        {guidedCopy.next}
      </button>
    </div>
  );
}

/** How long until the demo moves on; "Press Next →" in step-by-step mode. Only this re-renders on every tick. */
function BeatBar({ pacer }: { pacer: Pacer }) {
  const clock = useSyncExternalStore(pacer.subscribe, pacer.getSnapshot, pacer.getSnapshot);
  if (!clock.active) return null;
  if (clock.untilClick) return <p className="text-sm font-medium">{guidedCopy.pressNext}</p>;
  const pct = clock.durationMs > 0 ? Math.min(100, (clock.elapsedMs / clock.durationMs) * 100) : 100;
  return (
    <div className="flex items-center gap-2" data-testid="demo-beat-bar" data-frozen={clock.frozen ? "true" : "false"}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-warning-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="h-full rounded-full bg-amber-500 transition-[width] duration-100 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      {clock.frozen && <span className="whitespace-nowrap text-sm font-medium">{guidedCopy.paused}</span>}
    </div>
  );
}
