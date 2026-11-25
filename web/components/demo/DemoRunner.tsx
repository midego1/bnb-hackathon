"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useConnect, usePublicClient } from "wagmi";
import { LeaseDetail } from "@/components/lease/LeaseDetail";
import { Amount, PriceSourceBadge, StatusBadge, useMoney } from "@/components/ui";
import { Spinner, useToasts } from "@/components/Toasts";
import { escrowFactoryAbi, LeaseStatus, mockUsdtAbi } from "@/lib/contracts";
import { fastForward } from "@/lib/demo/anvil";
import { ledger, newContext, PATHS, stepsFor, type DemoApi, type DemoCtx, type DemoPath, type DemoStep, type DemoTx } from "@/lib/demo/script";
import { DEV_CONNECTOR_ID, devAccounts, setDevRole, type DevRole } from "@/lib/devAccounts";
import { friendlyError } from "@/lib/errors";
import { uploadEvidence } from "@/lib/evidence";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useTx } from "@/lib/hooks/useTx";
import { runInspection } from "@/lib/settlement";
import { usePrices } from "@/lib/usePrices";
import { ActorBoard, FlowStrip, type Wallets } from "./ActorBoard";
import { actorLabel, controls, errorCopy, inspectionCopy, intro, pageIntro, pageTitle, panels, summaryCopy } from "./copy";
import { StepTimeline, type StepStatus } from "./StepTimeline";

type Speed = "normal" | "fast";
type Phase = "idle" | "running" | "paused" | "waiting" | "error" | "done";

/** Normal speed: how long a caption stays up before its transactions start, and the pause between steps. */
const READ_MS = 1200;
const BETWEEN_MS = 2600;
const ROLE_SWITCH_TIMEOUT_MS = 10_000;

const actorTone: Record<DemoStep["actor"], string> = {
  landlord: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  tenant: "bg-success-soft text-success-fg",
  arbiter: "bg-danger-soft text-danger-fg",
  inspector: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
  anyone: "bg-surface-muted text-muted",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One-click guided demo: plays the whole KeyEscrow story against the real contracts on the local anvil chain,
 * switching the anvil demo accounts as it goes.
 *
 * On desktop it is a one-screen stage (the page never scrolls; app/globals.css pins it to the viewport): controls
 * on top, the actors with their live balances on the left, the current step and the real lease page in the middle,
 * the timeline of every step on the right, and the end summary over the middle. Below `lg` it stacks and scrolls.
 */
export function DemoRunner() {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  const { address, connector } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { send } = useTx();
  const queryClient = useQueryClient();
  const { prices } = usePrices();
  const money = useMoney();
  const { setCompact, clearSettled } = useToasts();

  // The stage reports every transaction itself (timeline, balances, money moved): no toasts over it.
  useEffect(() => {
    setCompact({ max: 0, successMs: 0 });
    return () => setCompact();
  }, [setCompact]);

  const [path, setPath] = useState<DemoPath>("happy");
  const [speed, setSpeed] = useState<Speed>("normal");
  const [stepMode, setStepMode] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pauseAsked, setPauseAsked] = useState(false);
  const [steps, setSteps] = useState<DemoStep[]>(() => stepsFor("happy"));
  const [statuses, setStatuses] = useState<StepStatus[]>([]);
  const [current, setCurrent] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DemoCtx | null>(null);
  const [txs, setTxs] = useState<Record<string, DemoTx[]>>({});
  const [wallets, setWallets] = useState<Wallets | null>(null);
  const [base, setBase] = useState<Wallets | null>(null);
  const [summaryHidden, setSummaryHidden] = useState(false);

  // The runner is a long-lived async loop; it reads the latest hook values through refs.
  const live = useRef({ address, connector, connectors, connectAsync, send, client, queryClient });
  useEffect(() => {
    live.current = { address, connector, connectors, connectAsync, send, client, queryClient };
  }, [address, connector, connectors, connectAsync, send, client, queryClient]);
  const ctxRef = useRef<DemoCtx | null>(null);
  const stepsRef = useRef<DemoStep[]>(steps);
  const curRef = useRef(-1);
  const tokenRef = useRef(0);
  const runsRef = useRef(0);
  const pausedRef = useRef(false);
  const speedRef = useRef<Speed>(speed);
  const stepModeRef = useRef(stepMode);
  const nextRef = useRef<(() => void) | null>(null);
  const walletsRef = useRef<Wallets | null>(null);
  const treasuryRef = useRef<Address | null>(null);
  const walletSeq = useRef(0);

  useEffect(
    () => () => {
      tokenRef.current++; // stop the loop when the page unmounts
      nextRef.current?.();
    },
    [],
  );

  const ready = !!deployment && !!client;
  const publish = () => setView(ctxRef.current ? { ...ctxRef.current } : null);
  const mark = (i: number, s: StepStatus) => setStatuses((prev) => prev.map((v, k) => (k === i ? s : v)));

  /** Re-read the live balances on the actor cards. Best effort: a failed read keeps the last numbers. */
  async function syncWallets() {
    const c = live.current.client;
    if (!c || !deployment) return;
    const seq = ++walletSeq.current;
    try {
      treasuryRef.current ??= (await c.readContract({ address: deployment.escrowFactory, abi: escrowFactoryAbi, functionName: "feeRecipient" })) as Address;
      const bal = (who: Address) => c.readContract({ address: deployment.mockUsdt, abi: mockUsdtAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
      const lease = ctxRef.current?.lease;
      const [landlord, tenant, treasury, escrow] = await Promise.all([
        bal(devAccounts.landlord),
        bal(devAccounts.tenant),
        bal(treasuryRef.current),
        lease ? bal(lease) : Promise.resolve(undefined),
      ]);
      if (seq !== walletSeq.current) return; // a newer read is on its way
      walletsRef.current = { landlord, tenant, treasury, escrow };
      setWallets(walletsRef.current);
    } catch {
      // keep the last balances on screen
    }
  }

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void syncWallets(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as soon as the chain is reachable
  }, [ready]);

  const api = (): DemoApi => ({
    deployment: deployment!,
    async as(role: DevRole) {
      setDevRole(role);
      if (live.current.connector?.id !== DEV_CONNECTOR_ID) {
        const dev = live.current.connectors.find((c) => c.id === DEV_CONNECTOR_ID);
        if (!dev) throw new Error("The demo accounts are not available in this build (NEXT_PUBLIC_DEV_ACCOUNTS=1).");
        await live.current.connectAsync({ connector: dev });
      }
      const want = devAccounts[role].toLowerCase();
      const t0 = Date.now();
      while (live.current.address?.toLowerCase() !== want) {
        if (Date.now() - t0 > ROLE_SWITCH_TIMEOUT_MS) {
          throw new Error(`Could not switch to the demo ${actorLabel[role].toLowerCase()} account. Pick it in the yellow Demo accounts bar, then press Retry.`);
        }
        await sleep(50);
      }
    },
    async tx(label, call) {
      const receipt = await live.current.send(label, call, { throwOnError: true });
      if (!receipt) throw new Error(`"${label}" did not go through.`);
      const id = stepsRef.current[curRef.current]?.id ?? "?";
      setTxs((t) => ({ ...t, [id]: [...(t[id] ?? []), { label, hash: receipt.transactionHash }] }));
      publish();
      await syncWallets();
      return receipt;
    },
    async read<T>(call: Parameters<DemoApi["read"]>[0]) {
      const c = live.current.client;
      if (!c) throw new Error("Not connected to the local chain.");
      return (await c.readContract(call as never)) as T;
    },
    async upload(files) {
      const blobs = await Promise.all(
        files.map(async (f) => {
          const res = await fetch(f.path);
          if (!res.ok) throw new Error(`The demo file ${f.name} is missing from the app (${res.status}).`);
          return new File([await res.blob()], f.name, { type: f.type });
        }),
      );
      const { items } = await uploadEvidence(blobs);
      publish();
      return items;
    },
    inspect: (input) => runInspection(input),
    async fastForward(seconds) {
      await fastForward(seconds);
      await live.current.queryClient.invalidateQueries();
    },
    async refresh() {
      await live.current.queryClient.refetchQueries({ type: "active" });
    },
  });

  /** Normal-speed pause that ends early when the presenter switches to fast, step mode or pause, or restarts. */
  async function nap(token: number, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (tokenRef.current !== token || speedRef.current === "fast" || stepModeRef.current || pausedRef.current) return;
      await sleep(100);
    }
  }

  /** Between steps: wait out the narration (normal), a click (step by step) or a resume (paused). */
  async function gate(token: number): Promise<boolean> {
    if (speedRef.current === "normal") await nap(token, BETWEEN_MS);
    for (;;) {
      if (tokenRef.current !== token) return false;
      if (stepModeRef.current) {
        setPhase("waiting");
        await new Promise<void>((r) => (nextRef.current = r));
        nextRef.current = null;
        if (tokenRef.current !== token) return false;
        if (stepModeRef.current) return true;
        continue; // step mode was switched off while waiting: fall through to auto
      }
      if (!pausedRef.current) return true;
      setPhase("paused");
      await sleep(100);
    }
  }

  async function loop(from: number, token: number) {
    const all = stepsRef.current;
    const deps = api();
    for (let i = from; i < all.length; i++) {
      curRef.current = i;
      setCurrent(i);
      mark(i, "running");
      setError(null);
      setPhase("running");
      setBase(walletsRef.current); // "money moved" counts from here
      if (speedRef.current === "normal") await nap(token, READ_MS);
      if (tokenRef.current !== token) return;
      try {
        await all[i].run(deps, ctxRef.current!);
      } catch (err) {
        if (tokenRef.current !== token) return;
        mark(i, "error");
        setError(friendlyError(err));
        setPhase("error");
        publish();
        return;
      }
      if (tokenRef.current !== token) return;
      await syncWallets();
      mark(i, "done");
      publish();
      if (i < all.length - 1 && !(await gate(token))) return;
    }
    setPhase("done");
    clearSettled(); // nothing may cover the summary
    setPauseAsked(false);
    pausedRef.current = false;
  }

  function start(p: DemoPath = path) {
    if (!ready) return;
    const token = ++tokenRef.current;
    nextRef.current?.();
    pausedRef.current = false;
    setPauseAsked(false);
    const list = stepsFor(p);
    stepsRef.current = list;
    ctxRef.current = newContext(p, runsRef.current++, prices?.rates.USDT.THB);
    if (walletsRef.current) walletsRef.current = { ...walletsRef.current, escrow: undefined }; // a fresh lease
    setWallets(walletsRef.current);
    setBase(null);
    setSummaryHidden(false);
    setPath(p);
    setSteps(list);
    setStatuses(list.map(() => "pending"));
    setTxs({});
    setError(null);
    publish();
    void loop(0, token);
  }

  function retry() {
    const token = ++tokenRef.current;
    void loop(Math.max(0, curRef.current), token);
  }

  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPauseAsked(pausedRef.current);
    if (!pausedRef.current && phase === "paused") setPhase("running");
  }

  function chooseSpeed(s: Speed) {
    speedRef.current = s;
    setSpeed(s);
  }

  function chooseStepMode(on: boolean) {
    stepModeRef.current = on;
    setStepMode(on);
    if (!on) nextRef.current?.(); // continue automatically if it was waiting for a click
  }

  // /demo?autoplay=1[&path=dispute|timeout][&speed=fast][&step=1]: the landing page's button starts right away.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (autoplayed.current || !ready) return;
    const q = new URLSearchParams(window.location.search);
    const p = q.get("path");
    const initial: DemoPath = p === "dispute" || p === "timeout" ? p : "happy";
    if (q.get("speed") === "fast") speedRef.current = "fast";
    if (q.get("step") === "1") stepModeRef.current = true;
    autoplayed.current = true;
    // Deferred so the state updates happen outside the effect body.
    const t = setTimeout(() => {
      setSpeed(speedRef.current);
      setStepMode(stepModeRef.current);
      setPath(initial);
      setSteps(stepsFor(initial));
      if (q.get("autoplay") === "1") start(initial);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once, as soon as the chain is reachable
  }, [ready]);

  const running = phase === "running" || phase === "paused" || phase === "waiting";
  const step = current >= 0 ? steps[current] : undefined;
  const doneCount = statuses.filter((s) => s === "done").length;
  const books = view ? ledger(view) : undefined;
  const showSummary = phase === "done" && !!view && !summaryHidden;
  // "Step n of m" is on the narration; the controls only say why nothing moves.
  const note = phase === "paused" ? controls.paused : running && pauseAsked ? controls.pausing : undefined;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1" data-testid="demo-runner" data-phase={phase}>
      {/* Controls: one row on desktop. */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{pageTitle}</h1>
          <Segmented
            label={controls.story}
            value={path}
            disabled={running}
            options={(Object.keys(PATHS) as DemoPath[]).map((p) => ({ value: p, label: PATHS[p].label, testId: `demo-path-${p}`, title: PATHS[p].blurb }))}
            onChange={(p) => {
              setPath(p);
              if (phase === "idle") setSteps(stepsFor(p));
            }}
          />
          <Segmented
            label={controls.speed}
            value={speed}
            options={[
              { value: "normal", label: controls.normal, testId: "demo-speed-normal" },
              { value: "fast", label: controls.fast, testId: "demo-speed-fast" },
            ]}
            onChange={chooseSpeed}
          />
          <Segmented
            label={controls.mode}
            value={stepMode ? "step" : "auto"}
            options={[
              { value: "auto", label: controls.auto, testId: "demo-mode-auto" },
              { value: "step", label: controls.step, testId: "demo-mode-step" },
            ]}
            onChange={(v) => chooseStepMode(v === "step")}
          />
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {note && (
              <span className="text-sm font-medium text-muted" data-testid="demo-phase-note">
                {note}
              </span>
            )}
            {!ready && <span className="text-sm text-subtle">{controls.connecting}</span>}
            {!running && phase !== "error" && (
              <BigButton onClick={() => start()} disabled={!ready} testId="demo-play">
                ▶ {phase === "done" ? controls.playAgain : controls.play}
              </BigButton>
            )}
            {phase === "waiting" && (
              <BigButton onClick={() => nextRef.current?.()} testId="demo-next">
                {controls.next}
              </BigButton>
            )}
            {running && !stepMode && (
              <button type="button" onClick={togglePause} data-testid="demo-pause" className={secondaryBtn}>
                {pauseAsked ? controls.resume : controls.pause}
              </button>
            )}
            {running && (
              <button type="button" onClick={() => start(path)} className={secondaryBtn}>
                {controls.restart}
              </button>
            )}
            {phase === "done" && summaryHidden && (
              <button type="button" onClick={() => setSummaryHidden(false)} className={secondaryBtn} data-testid="demo-show-summary">
                {controls.showSummary}
              </button>
            )}
          </div>
        </div>
        {phase !== "idle" && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-muted" aria-hidden>
            <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
        )}
      </div>

      {/* The stage: actors | current step + live lease page | timeline. */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[16.5rem_minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <div className="order-2 lg:order-none lg:flex lg:min-h-0 lg:flex-col">
          <ActorBoard wallets={wallets} base={running || phase === "error" ? base : null} actor={running || phase === "error" ? step?.actor : undefined} />
        </div>

        <div className="relative order-1 flex flex-col gap-3 lg:order-none lg:min-h-0">
          {phase === "idle" && <Intro path={path} />}

          {step && phase !== "done" && (
            <Narration step={step} index={current} total={steps.length} status={statuses[current]} caption={view ? step.caption(view, money) : ""}>
              <FlowStrip base={base} wallets={wallets} />
            </Narration>
          )}

          {phase === "error" && error && (
            <div data-testid="demo-error" className="shrink-0 rounded-2xl border border-danger-border bg-danger-soft px-5 py-4 text-danger-fg">
              <p className="text-base font-semibold">{errorCopy.title(current + 1, step?.title)}</p>
              <p className="mt-1 text-base">{error}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={retry} className={primarySmall} data-testid="demo-retry">
                  {errorCopy.retry}
                </button>
                <button type="button" onClick={() => start(path)} className={secondaryBtn}>
                  {errorCopy.startOver}
                </button>
              </div>
            </div>
          )}

          {showSummary && <Summary ctx={view} books={books} onAgain={() => start(view.path)} onPath={(p) => start(p)} onHide={() => setSummaryHidden(true)} />}

          <LivePanel lease={view?.lease} idle={phase === "idle"}>
            {view?.inspection && <InspectionCard ctx={view} />}
          </LivePanel>
        </div>

        <div className="order-3 lg:order-none lg:flex lg:min-h-0 lg:flex-col">
          <StepTimeline steps={steps} statuses={statuses} current={running || phase === "error" ? current : -1} txs={txs} lease={view?.lease} />
        </div>
      </div>
    </div>
  );
}

const secondaryBtn =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium hover:border-border-hover";
const primarySmall =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover";

function BigButton({ children, onClick, disabled, testId }: { children: ReactNode; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-2 text-base font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; testId: string; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-subtle lg:sr-only min-[1400px]:not-sr-only">{label}</span>
      <div className="inline-flex flex-wrap rounded-lg bg-surface-muted p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            title={o.title}
            aria-pressed={value === o.value}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === o.value
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Intro({ path }: { path: DemoPath }) {
  return (
    <section className="shrink-0 rounded-2xl border border-warning-border bg-warning-soft px-5 py-4 text-warning-fg xl:px-6 xl:py-5">
      <p className="text-base leading-relaxed xl:text-lg">{pageIntro}</p>
      <h2 className="mt-3 text-lg font-semibold">{intro.title}</h2>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-base">
        {intro.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <p className="mt-3 text-base">
        <span className="font-semibold">{PATHS[path].label}:</span> {PATHS[path].blurb}
      </p>
      <p className="mt-1 text-sm opacity-80">{intro.presenting}</p>
    </section>
  );
}

function Narration({
  step,
  index,
  total,
  status,
  caption,
  children,
}: {
  step: DemoStep;
  index: number;
  total: number;
  status?: StepStatus;
  caption: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="shrink-0 rounded-2xl border border-warning-border bg-warning-soft px-5 py-4 text-warning-fg xl:tall:px-6 xl:tall:py-5"
      data-testid="demo-narration"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold uppercase tracking-wide opacity-70">{panels.stepOf(index + 1, total)}</span>
        <span className={`rounded-full px-2.5 py-0.5 font-semibold ${actorTone[step.actor]}`}>{actorLabel[step.actor]}</span>
        {step.demoOnly && <span className="rounded-full bg-amber-300 px-2.5 py-0.5 font-semibold text-amber-950 dark:bg-amber-400">{step.demoOnly}</span>}
        {status === "running" && (
          <span className="inline-flex items-center gap-1 opacity-70">
            <Spinner /> {panels.working}
          </span>
        )}
      </div>
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight xl:tall:text-3xl">{step.title}</h2>
      <p className="mt-1.5 text-lg leading-relaxed xl:tall:text-xl xl:tall:leading-relaxed">{caption}</p>
      {children && <div className="mt-3 border-t border-warning-border pt-2.5">{children}</div>}
    </section>
  );
}

/** The real lease page (the same component landlord and tenant use), scrolling inside its own panel. */
function LivePanel({ lease, idle, children }: { lease?: Address; idle: boolean; children?: ReactNode }) {
  if (idle && !lease) return null;
  return (
    <section
      aria-labelledby="live-lease"
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:min-h-0 lg:flex-1"
    >
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2">
        <h2 id="live-lease" className="text-base font-semibold">
          {panels.live}
        </h2>
        <span className="hidden min-w-0 flex-1 truncate text-sm text-subtle xl:block">{panels.liveNote}</span>
        {lease && (
          <Link href={`/lease/${lease}`} target="_blank" className="text-sm font-medium underline-offset-4 hover:underline">
            {panels.openTab}
          </Link>
        )}
      </div>
      <div className="relative space-y-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-testid="demo-live">
        {children}
        {lease ? <LeaseDetail address={lease} /> : <p className="text-base text-subtle">{panels.liveEmpty}</p>}
      </div>
    </section>
  );
}

function InspectionCard({ ctx }: { ctx: DemoCtx }) {
  const r = ctx.inspection!;
  return (
    <section className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-900 dark:bg-cyan-950/40" data-testid="demo-inspection">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{inspectionCopy.title}</h3>
        <PriceSourceBadge />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-muted">{inspectionCopy.back}</p>
          <Amount value={BigInt(r.tenantRefund)} />
        </div>
        <div>
          <p className="text-sm text-muted">{inspectionCopy.keeps}</p>
          <Amount value={BigInt(r.landlordClaim)} />
        </div>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
        {r.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted" data-testid="demo-inspector">
        {r.inspector ? inspectionCopy.signed(r.inspector.name, r.inspector.agentId) : inspectionCopy.unsigned}{" "}
        {inspectionCopy.meta(r.confidence, r.mock, r.provider)} <span className="font-mono">{r.reportHash.slice(0, 10)}…</span>
      </p>
    </section>
  );
}

function Summary({
  ctx,
  books,
  onAgain,
  onPath,
  onHide,
}: {
  ctx: DemoCtx;
  books: ReturnType<typeof ledger>;
  onAgain: () => void;
  onPath: (p: DemoPath) => void;
  onHide: () => void;
}) {
  const money = useMoney();
  const settled = ctx.finalStatus === LeaseStatus.Settled;
  const others = (Object.keys(PATHS) as DemoPath[]).filter((p) => p !== ctx.path);
  return (
    <section
      className="rounded-2xl border border-emerald-300 bg-surface p-4 shadow-lg dark:border-emerald-800 lg:absolute lg:inset-0 lg:z-10 lg:flex lg:flex-col lg:overflow-y-auto tall:p-5 xl:tall:p-6"
      data-testid="demo-summary"
      data-path={ctx.path}
      data-status={settled ? "settled" : "open"}
      data-balanced={books?.balanced ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight xl:tall:text-3xl">{summaryCopy.outcome[ctx.path]}</h2>
        <button
          type="button"
          onClick={onHide}
          className="hidden shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-muted hover:bg-surface-muted lg:block"
          data-testid="demo-hide-summary"
        >
          {summaryCopy.hide}
        </button>
      </div>
      <p className="mt-1 text-base text-muted">
        {ctx.finalStatus !== undefined && (
          <span className="mr-2 inline-block align-middle">
            <StatusBadge status={ctx.finalStatus as LeaseStatus} />
          </span>
        )}
        {summaryCopy.terms(ctx.property.name, money(ctx.rent), money(ctx.deposit))}
      </p>
      {books && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 tall:mt-4 tall:gap-3">
            <Party who={summaryCopy.tenant} note={summaryCopy.tenantNote(money(books.paidIn))} value={books.tenantBack} testId="demo-bal-tenant" />
            <Party who={summaryCopy.landlord} note={summaryCopy.landlordNote} value={books.landlord} testId="demo-bal-landlord" />
            <Party who={summaryCopy.treasury} note={summaryCopy.treasuryNote} value={books.treasury} testId="demo-bal-treasury" />
            <Party who={summaryCopy.escrow} note={summaryCopy.escrowNote} value={books.escrowLeft} testId="demo-bal-escrow" />
          </div>
          <p
            className={`mt-3 text-base font-medium tall:mt-4 ${books.balanced ? "text-success" : "text-danger"}`}
            data-testid="demo-balanced"
          >
            {books.balanced
              ? summaryCopy.balanced(money(books.paidIn), money(books.tenantBack), money(books.landlord), money(books.treasury))
              : summaryCopy.unbalanced}
          </p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2 lg:mt-auto lg:pt-3">
        <button type="button" onClick={onAgain} className={primarySmall} data-testid="demo-run-again">
          {summaryCopy.again}
        </button>
        {others.map((p) => (
          <button key={p} type="button" onClick={() => onPath(p)} className={secondaryBtn} data-testid={`demo-try-${p}`}>
            {summaryCopy.tryLabel[p]}
          </button>
        ))}
        {ctx.lease && (
          <Link href={`/lease/${ctx.lease}`} target="_blank" className={`${secondaryBtn} lg:hidden`}>
            {summaryCopy.openLease}
          </Link>
        )}
      </div>
    </section>
  );
}

function Party({ who, note, value, testId }: { who: string; note: string; value: bigint; testId: string }) {
  return (
    <div className="rounded-xl bg-surface-muted px-4 py-2 tall:py-3" data-testid={testId} data-value={value.toString()}>
      <p className="text-base font-semibold">{who}</p>
      <p className="text-sm leading-snug text-subtle">{note}</p>
      <div className="mt-1">
        <Amount value={value} size="lg" />
      </div>
    </div>
  );
}
