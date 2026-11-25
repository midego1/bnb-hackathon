"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useConnect, usePublicClient } from "wagmi";
import { LeaseDetail } from "@/components/lease/LeaseDetail";
import { Amount, Card, Notice, PriceSourceBadge, StatusBadge, useMoney } from "@/components/ui";
import { Spinner, useToasts } from "@/components/Toasts";
import { LeaseStatus } from "@/lib/contracts";
import { fastForward } from "@/lib/demo/anvil";
import { ledger, newContext, PATHS, stepsFor, type DemoActor, type DemoApi, type DemoCtx, type DemoPath, type DemoStep, type DemoTx } from "@/lib/demo/script";
import { DEV_CONNECTOR_ID, devAccounts, setDevRole, type DevRole } from "@/lib/devAccounts";
import { friendlyError } from "@/lib/errors";
import { uploadEvidence } from "@/lib/evidence";
import { shortAddress } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useTx } from "@/lib/hooks/useTx";
import { runInspection } from "@/lib/settlement";
import { usePrices } from "@/lib/usePrices";

type Speed = "normal" | "fast";
type StepStatus = "pending" | "running" | "done" | "error";
type Phase = "idle" | "running" | "paused" | "waiting" | "error" | "done";

/** Normal speed: how long a caption stays up before its transactions start, and the pause between steps. */
const READ_MS = 1200;
const BETWEEN_MS = 2600;
const ROLE_SWITCH_TIMEOUT_MS = 10_000;

const actorLabel: Record<DemoActor, string> = {
  landlord: "Landlord",
  tenant: "Tenant",
  arbiter: "Dispute desk",
  inspector: "KeyEscrow Inspector (AI agent)",
  anyone: "Anyone",
};
const actorTone: Record<DemoActor, string> = {
  landlord: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  tenant: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  arbiter: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  inspector: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  anyone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One-click guided demo: plays the whole KeyEscrow story against the real contracts on the local anvil chain,
 * switching the anvil demo accounts as it goes, with the real lease page rendered live underneath.
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

  // Transactions follow each other quickly here: keep at most two toasts on screen and let successes go fast.
  useEffect(() => {
    setCompact({ max: 2, successMs: 2500 });
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

  return (
    <div className="space-y-6" data-testid="demo-runner" data-phase={phase}>
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Segmented
              label="Story"
              value={path}
              disabled={running}
              options={(Object.keys(PATHS) as DemoPath[]).map((p) => ({ value: p, label: PATHS[p].label, testId: `demo-path-${p}` }))}
              onChange={(p) => {
                setPath(p);
                if (phase === "idle") setSteps(stepsFor(p));
              }}
            />
            <p className="text-xs text-slate-500">{PATHS[path].blurb}</p>
            <div className="flex flex-wrap gap-4">
              <Segmented
                label="Speed"
                value={speed}
                options={[
                  { value: "normal", label: "Normal", testId: "demo-speed-normal" },
                  { value: "fast", label: "Fast", testId: "demo-speed-fast" },
                ]}
                onChange={chooseSpeed}
              />
              <Segmented
                label="Mode"
                value={stepMode ? "step" : "auto"}
                options={[
                  { value: "auto", label: "Autoplay", testId: "demo-mode-auto" },
                  { value: "step", label: "Step by step", testId: "demo-mode-step" },
                ]}
                onChange={(v) => chooseStepMode(v === "step")}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!running && phase !== "error" && (
              <BigButton onClick={() => start()} disabled={!ready} testId="demo-play">
                ▶ {phase === "done" ? "Play again" : "Play the demo"}
              </BigButton>
            )}
            {phase === "waiting" && (
              <BigButton onClick={() => nextRef.current?.()} testId="demo-next">
                Next step →
              </BigButton>
            )}
            {running && !stepMode && (
              <button type="button" onClick={togglePause} data-testid="demo-pause" className={secondaryBtn}>
                {pauseAsked ? "▶ Resume" : "❚❚ Pause"}
              </button>
            )}
            {running && (
              <button type="button" onClick={() => start(path)} className={secondaryBtn}>
                ↺ Restart
              </button>
            )}
          </div>
        </div>
        {!ready && <p className="mt-3 text-sm text-slate-500">Connecting to the local chain…</p>}
        {running && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500" data-testid="demo-phase-note">
              {phase === "paused"
                ? "Paused. Press Resume to continue."
                : phase === "waiting"
                  ? "Step by step: press Next step when you are ready."
                  : pauseAsked
                    ? "Pausing after this step…"
                    : `Step ${current + 1} of ${steps.length}`}
            </p>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Rail steps={steps} statuses={statuses} current={running || phase === "error" ? current : -1} txs={txs} lease={view?.lease} />
        </aside>

        <div className="min-w-0 space-y-6">
          {phase === "idle" && <Intro />}

          {step && phase !== "done" && (
            <Narration step={step} index={current} total={steps.length} status={statuses[current]} caption={view ? step.caption(view, money) : ""} />
          )}

          {phase === "error" && error && (
            <div data-testid="demo-error">
              <Notice kind="error">
                <p className="font-medium">Step {current + 1} ({step?.title}) did not work</p>
                <p className="mt-1">{error}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={retry} className={primarySmall} data-testid="demo-retry">
                    Retry this step
                  </button>
                  <button type="button" onClick={() => start(path)} className={secondaryBtn}>
                    Start over with a fresh lease
                  </button>
                </div>
              </Notice>
            </div>
          )}

          {phase === "done" && view && <Summary ctx={view} books={books} onAgain={() => start(view.path)} onPath={(p) => start(p)} />}

          {view?.inspection && <InspectionCard ctx={view} />}

          {view?.lease ? (
            <section aria-labelledby="live-lease">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="live-lease" className="text-lg font-semibold">
                  The real lease page, live
                </h2>
                <Link href={`/lease/${view.lease}`} target="_blank" className="text-sm underline-offset-4 hover:underline">
                  Open in its own tab ↗
                </Link>
              </div>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                The same component landlord and tenant use, re-rendered after every transaction. It changes as the demo switches accounts.
              </p>
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
                <LeaseDetail address={view.lease} />
              </div>
            </section>
          ) : (
            phase !== "idle" && <p className="text-sm text-slate-500">The lease page appears here as soon as the landlord has created the lease.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const secondaryBtn =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:border-slate-500 dark:border-slate-700 dark:bg-slate-900";
const primarySmall =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900";

function BigButton({ children, onClick, disabled, testId }: { children: ReactNode; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3 text-base font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
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
  options: { value: T; label: string; testId: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === o.value}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === o.value ? "bg-white shadow-sm dark:bg-slate-950" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Rail({
  steps,
  statuses,
  current,
  txs,
  lease,
}: {
  steps: DemoStep[];
  statuses: StepStatus[];
  current: number;
  txs: Record<string, DemoTx[]>;
  lease?: Address;
}) {
  return (
    <Card title="The story" aside={lease && <Link href={`/lease/${lease}`} target="_blank" className="font-mono text-xs underline">{shortAddress(lease)}</Link>}>
      <ol className="space-y-1" data-testid="demo-rail">
        {steps.map((s, i) => {
          const st = statuses[i] ?? "pending";
          return (
            <li
              key={s.id}
              data-testid="demo-step"
              data-step={s.id}
              data-status={st}
              className={`rounded-xl px-2 py-2 transition ${i === current ? "bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:ring-amber-900" : ""}`}
            >
              <div className="flex items-start gap-2">
                <StepIcon status={st} n={i + 1} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${st === "pending" ? "text-slate-500" : ""}`}>{s.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {actorLabel[s.actor]}
                    {s.demoOnly && <span className="ml-1 rounded bg-amber-200 px-1 font-medium text-amber-950">{s.demoOnly}</span>}
                  </p>
                  {(txs[s.id] ?? []).map((t) => (
                    <p key={t.hash} className="mt-0.5 flex items-center justify-between gap-1 text-[11px]">
                      <span className="min-w-0 truncate text-slate-500">{t.label}</span>
                      <Link href={lease ? `/lease/${lease}` : "#"} target="_blank" title={`Transaction ${t.hash}: see it on the lease timeline`} className="shrink-0 whitespace-nowrap font-mono underline decoration-dotted" data-testid="demo-tx">
                        {t.hash.slice(0, 8)}…{t.hash.slice(-4)}
                      </Link>
                    </p>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function StepIcon({ status, n }: { status: StepStatus; n: number }) {
  const base = "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold";
  if (status === "done") return <span className={`${base} bg-emerald-500 text-white`} aria-label="done">✓</span>;
  if (status === "error") return <span className={`${base} bg-rose-500 text-white`} aria-label="failed">!</span>;
  if (status === "running") return <span className={`${base} bg-amber-400 text-slate-950`} aria-label="running"><Spinner /></span>;
  return <span className={`${base} bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}>{n}</span>;
}

function Intro() {
  return (
    <Card>
      <h2 className="text-lg font-semibold">What you are about to see</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>A fresh Bangkok lease, created, funded and settled with real transactions on this local anvil chain.</li>
        <li>The demo switches between the landlord, tenant and dispute desk accounts for you (watch the yellow bar).</li>
        <li>Every amount in baht first, then dollars and the exact mUSDT on-chain.</li>
        <li>The AI move-out inspection, the KeyEscrow fee going to the treasury, and the final balances.</li>
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Presenting live? Pick <span className="font-medium">Step by step</span>: each step waits for your click. Pause works any time.
      </p>
    </Card>
  );
}

function Narration({ step, index, total, status, caption }: { step: DemoStep; index: number; total: number; status?: StepStatus; caption: string }) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-50" data-testid="demo-narration" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide opacity-70">
          Step {index + 1} of {total}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${actorTone[step.actor]}`}>{actorLabel[step.actor]}</span>
        {step.demoOnly && <span className="rounded-full bg-amber-300 px-2 py-0.5 font-semibold text-amber-950">{step.demoOnly}</span>}
        {status === "running" && (
          <span className="inline-flex items-center gap-1 opacity-70">
            <Spinner /> working…
          </span>
        )}
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{step.title}</h2>
      <p className="mt-2 max-w-3xl text-base leading-relaxed">{caption}</p>
    </section>
  );
}

function InspectionCard({ ctx }: { ctx: DemoCtx }) {
  const r = ctx.inspection!;
  return (
    <Card title="AI move-out inspection" aside={<PriceSourceBadge />}>
      <div data-testid="demo-inspection">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500">Back to tenant</p>
            <Amount value={BigInt(r.tenantRefund)} />
          </div>
          <div>
            <p className="text-xs text-slate-500">Landlord keeps (repairs)</p>
            <Amount value={BigInt(r.landlordClaim)} />
          </div>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {r.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500" data-testid="demo-inspector">
          {r.inspector ? (
            <>
              Signed by {r.inspector.name}
              {r.inspector.agentId !== undefined && <>, ERC-8004 agent #{r.inspector.agentId}</>}: its identity is registered on BNB Chain, so anyone can check this
              report came from it.
            </>
          ) : (
            <>
              Report by the KeyEscrow Inspector agent. Unsigned on this local demo (no INSPECTOR_PRIVATE_KEY set); with its key set, every report is signed by the
              agent&apos;s ERC-8004 identity on BNB Chain.
            </>
          )}{" "}
          Confidence {(r.confidence * 100).toFixed(0)}% · {r.mock ? "demo inspector (no AI key configured)" : `vision model: ${r.provider}`} · report{" "}
          <span className="font-mono">{r.reportHash.slice(0, 10)}…</span>
        </p>
      </div>
    </Card>
  );
}

const tryLabel: Record<DemoPath, string> = {
  happy: "Try the happy path",
  dispute: "Try the dispute path",
  timeout: "Try: landlord ignores it",
};

const outcome: Record<DemoPath, string> = {
  happy: "Settled in one click: the split was agreed",
  dispute: "Settled by the KeyEscrow dispute desk",
  timeout: "The landlord stayed silent: full deposit back to the tenant",
};

function Summary({
  ctx,
  books,
  onAgain,
  onPath,
}: {
  ctx: DemoCtx;
  books: ReturnType<typeof ledger>;
  onAgain: () => void;
  onPath: (p: DemoPath) => void;
}) {
  const money = useMoney();
  const settled = ctx.finalStatus === LeaseStatus.Settled;
  const others = (Object.keys(PATHS) as DemoPath[]).filter((p) => p !== ctx.path);
  return (
    <section
      className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm dark:border-emerald-900 dark:bg-slate-900"
      data-testid="demo-summary"
      data-path={ctx.path}
      data-status={settled ? "settled" : "open"}
      data-balanced={books?.balanced ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{outcome[ctx.path]}</h2>
        {ctx.finalStatus !== undefined && <StatusBadge status={ctx.finalStatus as LeaseStatus} />}
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {ctx.property.name} · {money(ctx.rent)} / month · {money(ctx.deposit)} deposit. Final balances of this lease:
      </p>
      {books && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Party who="Tenant" note={`got back, of ${money(books.paidIn)} paid in`} value={books.tenantBack} testId="demo-bal-tenant" />
            <Party who="Landlord" note="month 1 rent after fee + repairs" value={books.landlord} testId="demo-bal-landlord" />
            <Party who="KeyEscrow treasury" note="one-time fee" value={books.treasury} testId="demo-bal-treasury" />
            <Party who="Escrow contract" note="left in escrow" value={books.escrowLeft} testId="demo-bal-escrow" />
          </div>
          <p className={`mt-4 text-sm font-medium ${books.balanced ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700"}`} data-testid="demo-balanced">
            {books.balanced
              ? `✓ Balances add up: the tenant's ${money(books.paidIn)} went back to the tenant (${money(books.tenantBack)}), to the landlord (${money(books.landlord)}) and to the treasury (${money(books.treasury)}). The escrow holds nothing.`
              : "✗ The balances do not add up. Open the lease page to inspect the timeline."}
          </p>
        </>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onAgain} className={primarySmall} data-testid="demo-run-again">
          ↺ Run again
        </button>
        {others.map((p) => (
          <button key={p} type="button" onClick={() => onPath(p)} className={secondaryBtn} data-testid={`demo-try-${p}`}>
            {tryLabel[p]}
          </button>
        ))}
        {ctx.lease && (
          <Link href={`/lease/${ctx.lease}`} target="_blank" className={secondaryBtn}>
            Open the lease page ↗
          </Link>
        )}
      </div>
    </section>
  );
}

function Party({ who, note, value, testId }: { who: string; note: string; value: bigint; testId: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60" data-testid={testId} data-value={value.toString()}>
      <p className="text-sm font-medium">{who}</p>
      <p className="text-xs text-slate-500">{note}</p>
      <div className="mt-1">
        <Amount value={value} />
      </div>
    </div>
  );
}
