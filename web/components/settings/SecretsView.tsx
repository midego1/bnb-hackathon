"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ActionButton, Card, Notice, PageTitle, Skeleton, inputClass } from "@/components/ui";

/**
 * The write-only secrets page. A value is read from the input once, the input is cleared before the request leaves,
 * and the value is never put in React state: the only thing that comes back is SET / NOT SET and "Saved at <time>".
 */

type FileStatus = { target: "root" | "web"; label: string; set: boolean };
type Secret = {
  name: string;
  group: string;
  groupLabel: string;
  purpose: string;
  source: { label: string; url?: string };
  format: string;
  note?: string;
  files: FileStatus[];
  set: boolean;
  restart: { unit: string; label: string }[];
  testable: boolean;
};
type TestOutcome = { status: "valid" | "invalid" | "untestable"; reason: string; testedAt: string; source: "stored" | "typed" };
type Unit = { unit: string; label: string; loaded: boolean; active: string; since: string };
type Listing = { secrets: Secret[]; units: Unit[]; restartEnabled: boolean };

const API = "/api/settings/secrets";
const PASSCODE_PATH = "~/projects/bnb-hackathon/.orca/secrets/settings-passcode";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

export function SecretsView() {
  const [phase, setPhase] = useState<"loading" | "locked" | "ready" | "error">("loading");
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Applies a GET answer: locked, error or the listing. */
  const apply = useCallback((res: Response, data: Record<string, unknown>): Listing | null => {
    if (res.status === 401) {
      setPhase("locked");
      setListing(null);
      return null;
    }
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : `Request failed (${res.status}).`);
      setPhase("error");
      return null;
    }
    setListing(data as unknown as Listing);
    setPhase("ready");
    return data as unknown as Listing;
  }, []);

  const load = useCallback(async () => {
    const { res, data } = await api(API);
    return apply(res, data);
  }, [apply]);

  useEffect(() => {
    api(API)
      .then(({ res, data }) => apply(res, data))
      .catch(() => {
        setError("The server did not answer.");
        setPhase("error");
      });
  }, [apply]);

  const lock = async () => {
    await api(`${API}/session`, { method: "DELETE" }).catch(() => {});
    setListing(null);
    setPhase("locked");
  };

  return (
    <div data-testid="secrets-page">
      <PageTitle title="Secrets">
        Set the API keys and testnet keys the scooter rental app runs with. Values are written straight into the server&apos;s
        env files and are never shown again: this page only tells you whether a name is set.
      </PageTitle>
      {phase === "loading" && <Skeleton className="h-40" />}
      {phase === "error" && <Notice kind="error">{error}</Notice>}
      {phase === "locked" && <Unlock onUnlocked={() => void load()} />}
      {phase === "ready" && listing && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Local only: this page exists on the paseo-box units and answers only on this machine and the tailnet.
            </p>
            <ActionButton variant="secondary" onClick={() => void lock()} data-testid="secrets-lock">
              Lock
            </ActionButton>
          </div>
          {listing.restartEnabled && <Units units={listing.units} reload={load} />}
          {groups(listing.secrets).map(([label, items]) => (
            <Card key={label} title={label}>
              <ul className="flex flex-col divide-y divide-border">
                {items.map((s) => (
                  <SecretRow key={s.name} secret={s} onChanged={() => void load()} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function groups(secrets: Secret[]): [string, Secret[]][] {
  const out = new Map<string, Secret[]>();
  for (const s of secrets) out.set(s.groupLabel, [...(out.get(s.groupLabel) ?? []), s]);
  return [...out];
}

function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = ref.current;
    if (!input) return;
    const passcode = input.value;
    input.value = "";
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await api(`${API}/session`, { method: "POST", body: JSON.stringify({ passcode }) });
      if (res.ok) onUnlocked();
      else setError(typeof data.error === "string" ? data.error : "Could not unlock.");
    } catch {
      setError("The server did not answer.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Enter the admin passcode" className="max-w-xl">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" data-testid="secrets-unlock">
        <p className="text-sm text-muted">
          The server created it on first use. Read it on paseo-box with{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">cat {PASSCODE_PATH}</code>
        </p>
        <input
          ref={ref}
          type="password"
          name="passcode"
          aria-label="Passcode"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
          data-testid="secrets-passcode"
        />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <ActionButton type="submit" busy={busy} className="self-start" data-testid="secrets-unlock-submit">
          Unlock
        </ActionButton>
      </form>
    </Card>
  );
}

function StatusChip({ set, label }: { set: boolean; label?: string }) {
  return (
    <span
      data-testid="secret-status"
      data-set={set ? "1" : "0"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        set ? "bg-success-soft text-success-fg ring-success-border" : "bg-surface-muted text-subtle ring-border"
      }`}
    >
      {set ? "SET" : "NOT SET"}
      {label && <span className="font-normal">· {label}</span>}
    </span>
  );
}

function SecretRow({ secret: s, onChanged }: { secret: Secret; onChanged: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"save" | "clear" | "test" | "testTyped" | null>(null);
  const [savedAt, setSavedAt] = useState<{ at: string; cleared: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<TestOutcome | null>(null);

  /** Test the stored value, or (typed) the value in the field without saving it. Only the verdict is kept. */
  const test = async (typed: boolean) => {
    const value = typed ? ref.current?.value : undefined;
    if (typed && !value) {
      setError("Type a value to test first.");
      return;
    }
    setBusy(typed ? "testTyped" : "test");
    setError(null);
    try {
      const { res, data } = await api(`${API}/test`, { method: "POST", body: JSON.stringify(typed ? { name: s.name, value } : { name: s.name }) });
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not run the test.");
        return;
      }
      setTested({ status: data.status as TestOutcome["status"], reason: String(data.reason), testedAt: String(data.testedAt), source: data.source as TestOutcome["source"] });
    } catch {
      setError("The server did not answer.");
    } finally {
      setBusy(null);
    }
  };

  const send = async (payload: Record<string, unknown>, kind: "save" | "clear") => {
    setBusy(kind);
    setError(null);
    try {
      const { res, data } = await api(API, { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save.");
        return;
      }
      setSavedAt({ at: new Date(String(data.savedAt)).toLocaleTimeString(), cleared: kind === "clear" });
      onChanged();
    } catch {
      setError("The server did not answer.");
    } finally {
      setBusy(null);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const input = ref.current;
    if (!input || !input.value) return;
    const value = input.value;
    input.value = ""; // cleared before the request goes out; the value lives only in this closure
    void send({ name: s.name, value }, "save");
  };

  const clear = () => {
    if (!window.confirm(`Clear ${s.name}? The current value is removed from ${s.files.map((f) => f.label).join(" and ")}.`)) return;
    void send({ name: s.name, action: "clear" }, "clear");
  };

  const id = `secret-${s.name}`;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" data-testid={id}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-sm font-semibold">{s.name}</code>
        {s.files.length === 1 ? (
          <StatusChip set={s.files[0].set} />
        ) : (
          s.files.map((f) => <StatusChip key={f.target} set={f.set} label={f.label} />)
        )}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted">{s.purpose}</p>
        <p className="text-subtle">
          Get it: {s.source.url ? (
            <a href={s.source.url} target="_blank" rel="noreferrer noopener" className="text-foreground underline underline-offset-2">
              {s.source.label}
            </a>
          ) : (
            s.source.label
          )}
          {" · "}Format: {s.format}
        </p>
        <p className="text-subtle" data-testid="secret-where">
          Written to {s.files.map((f) => f.label).join(" and ")}
          {" · "}
          {s.restart.length ? <>Restart: {s.restart.map((u) => `${u.label} (${u.unit})`).join(", ")}</> : "No restart needed"}
        </p>
        {s.note && <p className="text-subtle">{s.note}</p>}
      </div>
      <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <input
          ref={ref}
          id={`${id}-input`}
          type="password"
          name="value"
          aria-label={`New value for ${s.name}`}
          placeholder={s.set ? "Replace the current value" : "Paste the value"}
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          className={`${inputClass} font-mono sm:flex-1`}
          data-testid="secret-input"
        />
        <div className="flex gap-2">
          <ActionButton type="submit" busy={busy === "save"} disabled={busy !== null} data-testid="secret-save">
            Save
          </ActionButton>
          <ActionButton type="button" variant="danger" busy={busy === "clear"} disabled={busy !== null || !s.files.some((f) => f.set)} onClick={clear} data-testid="secret-clear">
            Clear
          </ActionButton>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => void test(false)}
          disabled={busy !== null || !s.files.some((f) => f.set)}
          className="rounded-lg border border-border-strong px-3 py-1.5 font-medium transition hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-45"
          title={s.testable ? "Check the stored value with a free, read-only call" : "No free test for this name"}
          data-testid="secret-test"
        >
          {busy === "test" ? "Testing..." : "Test"}
        </button>
        <button
          type="button"
          onClick={() => void test(true)}
          disabled={busy !== null}
          className="rounded-lg border border-border-strong px-3 py-1.5 font-medium transition hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-45"
          title="Check the value in the field without saving it"
          data-testid="secret-test-typed"
        >
          {busy === "testTyped" ? "Testing..." : "Test before saving"}
        </button>
        {tested && <TestBadge outcome={tested} />}
      </div>
      {error && <p className="text-sm text-danger" role="alert" data-testid="secret-error">{error}</p>}
      {savedAt && !error && (
        <p className="text-sm text-success-fg" data-testid="secret-saved">
          {savedAt.cleared ? "Cleared" : "Saved"} at {savedAt.at}
          {s.restart.length > 0 && <> · restart {s.restart.map((u) => u.label).join(" and ")} to use it</>}
        </p>
      )}
    </li>
  );
}

const TEST_STYLE: Record<TestOutcome["status"], { label: string; className: string }> = {
  valid: { label: "Valid", className: "bg-success-soft text-success-fg ring-success-border" },
  invalid: { label: "Invalid", className: "bg-danger-soft text-danger-fg ring-danger-border" },
  untestable: { label: "Can't test", className: "bg-surface-muted text-subtle ring-border" },
};

function TestBadge({ outcome: o }: { outcome: TestOutcome }) {
  const st = TEST_STYLE[o.status] ?? TEST_STYLE.untestable;
  // The reason starts with the verdict ("Valid: models listed"); show the part after it next to the chip.
  const detail = o.reason.replace(/^(Valid|Invalid|Can't test)(:\s*|\s+|$)/, "");
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="secret-test-result" data-status={o.status} aria-live="polite">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${st.className}`}>{st.label}</span>
      {detail && <span className="text-muted">{detail}</span>}
      <span className="text-xs text-subtle">
        · {o.source === "typed" ? "typed value, not saved" : "stored value"} · {new Date(o.testedAt).toLocaleTimeString()}
      </span>
    </span>
  );
}

function Units({ units, reload }: { units: Unit[]; reload: () => Promise<Listing | null> }) {
  const [restarting, setRestarting] = useState<Record<string, "restarting" | "back" | "slow" | undefined>>({});
  const [error, setError] = useState<string | null>(null);

  const restart = async (u: Unit) => {
    if (!window.confirm(`Restart ${u.unit} (${u.label})? The page there is unavailable for a few seconds.`)) return;
    setError(null);
    setRestarting((r) => ({ ...r, [u.unit]: "restarting" }));
    const before = u.since;
    try {
      const { res, data } = await api(`${API}/restart`, { method: "POST", body: JSON.stringify({ unit: u.unit }) });
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not restart.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restart.");
      setRestarting((r) => ({ ...r, [u.unit]: undefined }));
      return;
    }
    // Poll until the unit is active again with a new start time (this server may be the one restarting).
    for (let i = 0; i < 80; i++) { // about two minutes
      await new Promise((r) => setTimeout(r, 1500));
      const now = await reload().catch(() => null);
      const state = now?.units.find((x) => x.unit === u.unit);
      if (state && state.active === "active" && state.since !== before) {
        setRestarting((r) => ({ ...r, [u.unit]: "back" }));
        return;
      }
    }
    setRestarting((r) => ({ ...r, [u.unit]: "slow" }));
  };

  return (
    <Card title="Services">
      <p className="mb-3 text-sm text-muted">A new value is used after the service that reads it restarts.</p>
      <ul className="flex flex-col gap-2">
        {units.map((u) => {
          const st = restarting[u.unit];
          return (
            <li key={u.unit} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`unit-${u.unit}`}>
              <span>
                <code className="font-mono">{u.unit}</code> <span className="text-muted">· {u.label} · </span>
                <span className={u.active === "active" ? "text-success-fg" : "text-subtle"}>{u.loaded ? u.active : "not running"}</span>
                {st === "restarting" && <span className="text-warning-fg"> · restarting...</span>}
                {st === "back" && <span className="text-success-fg"> · back up</span>}
                {st === "slow" && <span className="text-warning-fg"> · still restarting, reload the page in a moment</span>}
              </span>
              <ActionButton variant="secondary" busy={st === "restarting"} disabled={!u.loaded} onClick={() => void restart(u)}>
                Restart {u.unit}
              </ActionButton>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </Card>
  );
}
