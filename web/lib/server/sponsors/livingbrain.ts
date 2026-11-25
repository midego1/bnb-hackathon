import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env";
import { onCloudflare } from "../platform";
import { getSharedState, update } from "../state";
import { logSponsorCall, sponsorLogDir } from "./log";

/**
 * Per-scooter inspection memory for the AI inspector (docs/PRODUCT.md step 5). Living Brain
 * (https://docs.livingbrain.com, REST at api.livingbrain.com/v1) is the persistent memory when
 * LIVING_BRAIN_API_KEY + LIVING_BRAIN_SUBJECT_ID + LIVING_BRAIN_BRAIN_ID are set; otherwise a local JSONL file
 * (web/.sponsor-logs/inspections.jsonl) stands in and every response says so. Never called in tests.
 */

export interface InspectionMemoryEntry {
  scooterId: string;
  at: string;
  /** One line per finding, e.g. "left mirror scratched (minor)". */
  findings: string[];
  newDamage: boolean;
  reportHash?: string;
  rental?: string;
}

export interface RecalledMemory {
  /** Text the inspector sees before judging. */
  text: string;
  at?: string;
  source: "living-brain" | "local";
  similarity?: number;
}

export interface MemoryStatus {
  provider: "living-brain" | "local";
  configured: boolean;
  reason?: string;
}

export interface InspectionMemory {
  status: MemoryStatus;
  recall(scooterId: string): Promise<RecalledMemory[]>;
  remember(entry: InspectionMemoryEntry): Promise<{ stored: boolean; id?: string; error?: string }>;
}

type FetchLike = typeof fetch;

export function livingBrainConfig(env: Env = process.env) {
  const apiKey = env.LIVING_BRAIN_API_KEY;
  const subjectId = env.LIVING_BRAIN_SUBJECT_ID;
  const brainId = env.LIVING_BRAIN_BRAIN_ID;
  const base = (env.LIVING_BRAIN_BASE_URL || "https://api.livingbrain.com").replace(/\/+$/, "");
  const missing = [!apiKey && "LIVING_BRAIN_API_KEY", !subjectId && "LIVING_BRAIN_SUBJECT_ID", !brainId && "LIVING_BRAIN_BRAIN_ID"].filter(Boolean) as string[];
  return { apiKey, subjectId, brainId, base, missing, configured: missing.length === 0 && !env.VITEST };
}

export function describeEntry(e: InspectionMemoryEntry): string {
  const what = e.findings.length ? e.findings.join("; ") : "no damage found";
  return `Scooter ${e.scooterId} inspection on ${e.at.slice(0, 10)}${e.rental ? ` (rental ${e.rental})` : ""}: ${e.newDamage ? "NEW damage" : "no new damage"}. Findings: ${what}.${e.reportHash ? ` Report ${e.reportHash}.` : ""}`;
}

export class LivingBrainMemory implements InspectionMemory {
  readonly status: MemoryStatus = { provider: "living-brain", configured: true };
  constructor(
    private readonly cfg: ReturnType<typeof livingBrainConfig>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call<T>(method: "POST" | "GET", p: string, body?: unknown): Promise<T> {
    const started = Date.now();
    let status: number | null = null;
    const endpoint = `${method} /v1/brains/{brainId}${p}`;
    try {
      const res = await this.fetchImpl(`${this.cfg.base}/v1/brains/${encodeURIComponent(this.cfg.brainId!)}${p}`, {
        method,
        headers: { "x-api-key": this.cfg.apiKey!, "x-subject-id": this.cfg.subjectId!, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      status = res.status;
      const json = (await res.json().catch(() => null)) as T & { message?: string };
      await logSponsorCall({ sponsor: "livingbrain", endpoint, at: new Date(started).toISOString(), status, ok: res.ok, ms: Date.now() - started, note: res.ok ? undefined : String(json?.message ?? "").slice(0, 160) });
      if (!res.ok) throw new Error(`Living Brain ${res.status}: ${json?.message ?? "request failed"}`);
      return json;
    } catch (err) {
      if (status === null) await logSponsorCall({ sponsor: "livingbrain", endpoint, at: new Date(started).toISOString(), status, ok: false, ms: Date.now() - started, note: (err as Error).message.slice(0, 160) });
      throw err;
    }
  }

  async recall(scooterId: string): Promise<RecalledMemory[]> {
    const hits = await this.call<Array<{ title?: string; summary?: string; similarity?: number; status?: string }>>("POST", "/search", {
      query: `Scooter ${scooterId} damage and inspection history`,
      topK: 8,
      minSimilarity: 0.3,
    });
    return (Array.isArray(hits) ? hits : [])
      .filter((h) => h.status !== "archived" && `${h.title ?? ""} ${h.summary ?? ""}`.toLowerCase().includes(scooterId.toLowerCase()))
      .map((h) => ({ text: [h.title, h.summary].filter(Boolean).join(": "), source: "living-brain" as const, similarity: h.similarity }));
  }

  async remember(e: InspectionMemoryEntry) {
    try {
      const res = await this.call<{ id?: string }>("POST", "/captures", {
        kind: "note",
        label: `Scooter ${e.scooterId} inspection ${e.at.slice(0, 10)}`,
        content: describeEntry(e),
        bucket: "notes",
        // Idempotency key: re-sending the same report updates the capture instead of duplicating it.
        originRef: `keyescrow:${e.scooterId}:${e.reportHash ?? e.at}`,
        source: { app: "keyescrow", scooterId: e.scooterId },
      });
      return { stored: true, id: res?.id };
    } catch (err) {
      return { stored: false, error: (err as Error).message };
    }
  }
}

/** Offline stand-in so the "never charge old damage twice" rule still works without a Living Brain account. */
export class LocalInspectionMemory implements InspectionMemory {
  readonly status: MemoryStatus;
  constructor(
    private readonly file: string,
    reason: string,
  ) {
    this.status = { provider: "local", configured: false, reason };
  }

  private async all(): Promise<InspectionMemoryEntry[]> {
    try {
      return (await readFile(this.file, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  async recall(scooterId: string): Promise<RecalledMemory[]> {
    const id = scooterId.toLowerCase();
    return (await this.all())
      .filter((e) => e.scooterId.toLowerCase() === id)
      .slice(-8)
      .reverse()
      .map((e) => ({ text: describeEntry(e), at: e.at, source: "local" as const }));
  }

  async remember(e: InspectionMemoryEntry) {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(e)}\n`);
    return { stored: true };
  }
}

/**
 * The same stand-in on Cloudflare Workers, where there is no disk: entries live in the KeyEscrowState Durable Object
 * (lib/server/state), newest 500 kept.
 */
export class SharedInspectionMemory implements InspectionMemory {
  static readonly KEY = "inspections";
  readonly status: MemoryStatus;
  constructor(reason: string) {
    this.status = { provider: "local", configured: false, reason };
  }

  async recall(scooterId: string): Promise<RecalledMemory[]> {
    const id = scooterId.toLowerCase();
    const all = (await getSharedState().get<InspectionMemoryEntry[]>(SharedInspectionMemory.KEY))?.value ?? [];
    return all
      .filter((e) => e.scooterId.toLowerCase() === id)
      .slice(-8)
      .reverse()
      .map((e) => ({ text: describeEntry(e), at: e.at, source: "local" as const }));
  }

  async remember(e: InspectionMemoryEntry) {
    await update<InspectionMemoryEntry[], void>(getSharedState(), SharedInspectionMemory.KEY, (cur) => ({ value: [...(cur ?? []), e].slice(-500), result: undefined }));
    return { stored: true };
  }
}

export function inspectionMemoryFromEnv(env: Env = process.env, fetchImpl: FetchLike = fetch): InspectionMemory {
  const cfg = livingBrainConfig(env);
  if (cfg.configured) return new LivingBrainMemory(cfg, fetchImpl);
  if (onCloudflare()) {
    return new SharedInspectionMemory(`Living Brain not configured: set ${cfg.missing.join(", ") || "LIVING_BRAIN_*"} as Worker secrets. Using local memory.`);
  }
  return new LocalInspectionMemory(path.join(sponsorLogDir(env), "inspections.jsonl"), `Living Brain not configured: set ${cfg.missing.join(", ") || "LIVING_BRAIN_*"} in web/.env.local. Using local memory.`);
}
