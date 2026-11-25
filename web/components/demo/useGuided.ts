"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { instrumentApi, Pacer, upsertActivity, type Activity, type Beat, type Speed } from "@/lib/demo/pacing";
import { GUIDED } from "@/lib/demo/pacing";
import type { DemoApi } from "@/lib/demo/script";
import type { Wallets } from "./ActorBoard";

/** A caption that was on screen, kept so Back can show it again (with the balances of that moment). */
export type Shown = { beat: Beat; step: number; base: Wallets | null; wallets: Wallets | null };

/**
 * The beat layer of the /demo runner: which beat of the current step is on screen, the transaction lines, the
 * caption history for Back / Next, and the Pacer whose waits honour pause, skip and step-by-step mode. The runner
 * keeps executing steps exactly as before; it only calls show() / wait() around each step and runs it through wrap().
 */
export function useGuided(o: {
  speed: RefObject<Speed>;
  stepMode: RefObject<boolean>;
  paused: RefObject<boolean>;
  token: RefObject<number>;
  scale: RefObject<number>;
  onFreeze: (frozen: boolean) => void;
}) {
  const [beat, setBeat] = useState<Beat | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [history, setHistory] = useState<Shown[]>([]);
  const [review, setReview] = useState<number | null>(null);
  const [pacer, setPacer] = useState<Pacer | null>(null);
  const pacerRef = useRef<Pacer | null>(null);
  const freeze = useRef(o.onFreeze);
  useEffect(() => {
    freeze.current = o.onFreeze;
  });

  /** A fresh Pacer for run `token` (a restart cancels the waits of the previous one). */
  function bind(token: number, reset: boolean) {
    const p = new Pacer({
      alive: () => o.token.current === token,
      paused: () => !!o.paused.current,
      stepMode: () => !!o.stepMode.current,
      guided: () => o.speed.current === "guided",
      scale: () => o.scale.current ?? 1,
      onFreeze: (f) => freeze.current(f),
    });
    pacerRef.current = p;
    setPacer(p);
    if (reset) {
      setHistory([]);
      setBeat(null);
      setActivities([]);
    }
    setReview(null);
  }

  function show(b: Beat, step: number, base: Wallets | null, wallets: Wallets | null) {
    setBeat(b);
    if (b === "now" || b === "intro") setActivities([]);
    if (b !== "run") setHistory((h) => [...h, { beat: b, step, base, wallets }]);
    setReview(null);
  }

  const p = () => pacerRef.current;
  return {
    beat,
    activities,
    history,
    review,
    pacer,
    /** The caption to draw: a past one while reviewing, else undefined (draw the live beat). */
    shown: review !== null ? history[review] : undefined,
    bind,
    show,
    wait: (ms: number, kind?: "caption" | "timed") => p()?.wait(ms, kind) ?? Promise.resolve(true),
    hold: () => p()?.hold() ?? Promise.resolve(true),
    /** The step executor's DemoApi, reporting each transaction and holding before it while paused. */
    wrap: (api: DemoApi) =>
      instrumentApi(api, {
        gate: () => p()?.hold() ?? Promise.resolve(true),
        lead: () => p()?.wait(GUIDED.leadMs, "timed") ?? Promise.resolve(true),
        onActivity: (a) => setActivities((l) => upsertActivity(l, a)),
      }),
    /** Next →: forward through reviewed captions, else end the current wait. */
    next() {
      if (review !== null) {
        setReview(review + 1 >= history.length - 1 ? null : review + 1);
        return;
      }
      p()?.skip();
    },
    back() {
      const at = review ?? history.length - 1;
      if (at > 0) setReview(at - 1);
    },
    atStart: (review ?? history.length - 1) <= 0,
    clearReview: () => setReview(null),
  };
}

/** Presenter keys: space pauses / resumes, → / PageDown is Next, ← / PageUp is Back (clickers send those). */
export function useDemoKeys(handlers: { space?: () => void; next?: () => void; back?: () => void }) {
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      const act = e.key === " " ? h.current.space : e.key === "ArrowRight" || e.key === "PageDown" ? h.current.next : e.key === "ArrowLeft" || e.key === "PageUp" ? h.current.back : undefined;
      if (!act) return;
      e.preventDefault(); // also keeps space from clicking the focused button a second time
      if (!e.repeat) act();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " " && h.current.space && !typing(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
