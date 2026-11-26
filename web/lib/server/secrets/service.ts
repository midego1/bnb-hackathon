import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isTestable, testSecret, type TestResult } from "./testers";
import { envValue, isEnvSet, readEnvText, setEnvValue, validateSecretValue, writeEnvFileAtomic, formatHint } from "./envFile";
import { restartUnits, secretSpec, SECRETS, UNIT_NAMES, UNITS, type SecretGroup, type SecretTarget, type UnitName } from "./registry";

type Env = Record<string, string | undefined>;

/** The main checkout's repo-root .env (the units run from /home/orcasrv/projects/bnb-hackathon/web). */
export const DEFAULT_ROOT_ENV_FILE = "/home/orcasrv/projects/bnb-hackathon/.env";

export type SecretsConfig = {
  files: Record<SecretTarget, string>;
  /** <state>/backup/env, <state>/reports/secrets-audit.log, <state>/secrets/settings-passcode */
  stateDir: string;
  /** SETTINGS_SECRETS_RESTART=0 hides the restart buttons and skips systemctl entirely (used by the e2e run). */
  restart: boolean;
  /** agent/deployments/97.json of the main checkout: the registered report signer the inspector key is compared with. */
  agentDeployment: string;
  /** e2e only (SETTINGS_SECRETS_TEST_ORIGIN, http://127.0.0.1:<port> only): stub that stands in for the key-test APIs. */
  testOrigin?: string;
};

// Runtime paths only: turbopackIgnore keeps the build from tracing the whole checkout because of them.
export function secretsConfig(env: Env): SecretsConfig {
  const root = path.resolve(/* turbopackIgnore: true */ env.SECRETS_ENV_FILE || DEFAULT_ROOT_ENV_FILE);
  const repo = path.dirname(root);
  return {
    files: { root, web: path.resolve(/* turbopackIgnore: true */ env.SECRETS_WEB_ENV_FILE || path.join(/* turbopackIgnore: true */ repo, "web", ".env.local")) },
    stateDir: path.resolve(/* turbopackIgnore: true */ env.SETTINGS_SECRETS_STATE_DIR || path.join(/* turbopackIgnore: true */ repo, ".orca")),
    restart: env.SETTINGS_SECRETS_RESTART !== "0",
    agentDeployment: path.resolve(/* turbopackIgnore: true */ env.SETTINGS_SECRETS_AGENT_DEPLOYMENT || path.join(/* turbopackIgnore: true */ repo, "agent", "deployments", "97.json")),
    testOrigin: /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(env.SETTINGS_SECRETS_TEST_ORIGIN ?? "") ? env.SETTINGS_SECRETS_TEST_ORIGIN : undefined,
  };
}

export const passcodeFile = (cfg: SecretsConfig) => path.join(cfg.stateDir, "secrets", "settings-passcode");
const backupDir = (cfg: SecretsConfig) => path.join(cfg.stateDir, "backup", "env");
export const auditFile = (cfg: SecretsConfig) => path.join(cfg.stateDir, "reports", "secrets-audit.log");

const FILE_LABEL: Record<SecretTarget, string> = { root: ".env (repo root)", web: "web/.env.local" };
const BACKUP_LABEL: Record<SecretTarget, string> = { root: "root.env", web: "web.env.local" };

export type SecretStatus = {
  name: string;
  group: SecretGroup;
  purpose: string;
  source: { label: string; url?: string };
  format: string;
  note?: string;
  /** Per target file: whether the name has a non-empty value there. Never the value. */
  files: { target: SecretTarget; label: string; set: boolean }[];
  set: boolean;
  restart: { unit: UnitName; label: string }[];
  /** A public NEXT_PUBLIC_* value: used after a rebuild, not a restart. */
  rebuild: boolean;
  /** Whether a free, read-only key test exists for this name. */
  testable: boolean;
};

/** All allowlisted names with SET / NOT SET per file. Values are read only to test for emptiness. */
export async function listSecrets(cfg: SecretsConfig): Promise<SecretStatus[]> {
  const texts = { root: await readEnvText(cfg.files.root), web: await readEnvText(cfg.files.web) };
  return SECRETS.map((s) => {
    const files = s.targets.map((t) => ({ target: t, label: FILE_LABEL[t], set: isEnvSet(texts[t], s.name) }));
    return {
      name: s.name,
      group: s.group,
      purpose: s.purpose,
      source: s.source,
      format: formatHint(s.format),
      note: s.note,
      files,
      set: files.every((f) => f.set),
      restart: restartUnits(s).map((u) => ({ unit: u, label: UNITS[u].label })),
      rebuild: !!s.public,
      testable: isTestable(s.name),
    };
  });
}

export class SecretNameError extends Error {
  constructor() {
    super("Unknown name.");
  }
}

// One write at a time, so two saves cannot interleave read-edit-rename on the same file.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Sets (value) or clears (null) an allowlisted name in each of its files, with backups and an audit line. */
export async function writeSecret(cfg: SecretsConfig, name: unknown, value: unknown | null, ip: string | null, now = new Date()) {
  const spec = secretSpec(name);
  if (!spec) throw new SecretNameError();
  const clean = value === null ? null : validateSecretValue(spec, value);
  await serial(async () => {
    for (const t of spec.targets) {
      const file = cfg.files[t];
      const before = await readEnvText(file);
      const after = setEnvValue(before, spec.name, clean);
      if (after === before) continue;
      await writeEnvFileAtomic(file, after, { backupDir: backupDir(cfg), label: BACKUP_LABEL[t], now });
    }
  });
  await audit(cfg, { time: now, name: spec.name, action: clean === null ? "cleared" : "set", targets: spec.targets, ip });
  return { name: spec.name, set: clean !== null, savedAt: now.toISOString(), restart: restartUnits(spec) };
}

/** time, name, set/cleared/tested/restart, files (or the test result), client IP. Never the value. */
export async function audit(cfg: SecretsConfig, e: { time: Date; name: string; action: string; targets: SecretTarget[]; ip: string | null; detail?: string }) {
  const file = auditFile(cfg);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const ip = (e.ip ?? "unknown").replace(/[^0-9a-fA-F:.]/g, "").slice(0, 64) || "unknown";
  const col = e.detail ?? e.targets.join(",");
  await appendFile(file, `${e.time.toISOString()}\t${e.name}\t${e.action}\t${col}\t${ip}\n`, { mode: 0o600 });
}

/** The stored value of `name` (web/.env.local first, then the root .env). Server-side only, for key tests. */
async function storedValue(cfg: SecretsConfig, name: string): Promise<string | undefined> {
  for (const t of ["web", "root"] as const) {
    const v = envValue(await readEnvText(cfg.files[t]), name);
    if (v) return v;
  }
  return undefined;
}

async function agentReportSigner(cfg: SecretsConfig): Promise<string | undefined> {
  try {
    const signer = JSON.parse(await readFile(cfg.agentDeployment, "utf8")).reportSigner;
    return typeof signer === "string" ? signer : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tests the stored value (value undefined) or a typed value (validated first, never written). The audit line has the
 * name, "tested", stored/typed and the result status; the answer has status, reason and time. Never the value.
 */
export async function testStoredOrTyped(
  cfg: SecretsConfig,
  name: unknown,
  typed: unknown,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<TestResult & { name: string; source: "stored" | "typed"; testedAt: string }> {
  const spec = secretSpec(name);
  if (!spec) throw new SecretNameError();
  const source = typed === undefined || typed === null || typed === "" ? "stored" : "typed";
  let result: TestResult;
  const value = source === "typed" ? validateSecretValue(spec, typed) : await storedValue(cfg, spec.name);
  if (!value) result = { status: "untestable", reason: "Not set: nothing stored to test" };
  else {
    const cache = new Map<string, string | undefined>();
    const stored = (n: string) => cache.get(n);
    for (const n of ["CLOUDFLARE_API_TOKEN", "GREENFIELD_RPC_URL", "INSPECTOR_SIGNER_ADDRESS", "LIVING_BRAIN_API_KEY", "LIVING_BRAIN_SUBJECT_ID"]) cache.set(n, await storedValue(cfg, n));
    result = await testSecret(spec.name, value, {
      fetch: fetchImpl,
      stored,
      agentReportSigner: spec.name === "INSPECTOR_PRIVATE_KEY" ? await agentReportSigner(cfg) : undefined,
      apiOrigin: cfg.testOrigin,
    });
  }
  await audit(cfg, { time: now, name: spec.name, action: "tested", targets: [], detail: `${source}:${result.status}`, ip }).catch(() => {});
  return { name: spec.name, source, status: result.status, reason: result.reason, testedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------------------------------------
// systemd user units (allowlisted names only)
// ---------------------------------------------------------------------------------------------------------

export type UnitState = { unit: UnitName; label: string; loaded: boolean; active: string; since: string };

export type Systemctl = {
  show(unit: UnitName): Promise<Record<string, string>>;
  restart(unit: UnitName): void;
};

export const realSystemctl: Systemctl = {
  show: (unit) =>
    new Promise((resolve) => {
      execFile(
        "systemctl",
        ["--user", "show", "-p", "LoadState,ActiveState,ActiveEnterTimestampMonotonic", "--", unit],
        { timeout: 3000 },
        (err, stdout) => {
          if (err) return resolve({});
          resolve(Object.fromEntries(String(stdout).split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])));
        },
      );
    }),
  // --no-block: systemd queues the job and systemctl returns at once, so a unit can restart the server that asked.
  restart: (unit) => {
    const child = spawn("systemctl", ["--user", "--no-block", "restart", "--", unit], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  },
};

export function isUnitName(u: unknown): u is UnitName {
  return typeof u === "string" && (UNIT_NAMES as string[]).includes(u);
}

export async function unitStates(cfg: SecretsConfig, sys: Systemctl = realSystemctl): Promise<UnitState[]> {
  if (!cfg.restart) return [];
  return Promise.all(
    UNIT_NAMES.map(async (unit) => {
      const p = await sys.show(unit);
      return {
        unit,
        label: UNITS[unit].label,
        loaded: p.LoadState === "loaded",
        active: p.ActiveState || "unknown",
        since: p.ActiveEnterTimestampMonotonic || "0",
      };
    }),
  );
}

export function restartUnit(cfg: SecretsConfig, unit: unknown, sys: Systemctl = realSystemctl): UnitName {
  if (!cfg.restart || !isUnitName(unit)) throw new SecretNameError();
  sys.restart(unit);
  return unit;
}
