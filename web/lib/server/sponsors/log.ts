import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env";
import { onCloudflare } from "../platform";
import { getSharedState, update } from "../state";

/** One outbound sponsor API call. Never holds a key, header or full URL with secrets. */
export interface SponsorCall {
  sponsor: "cmc" | "cournot" | "atlas" | "livingbrain";
  /** Method + path (+ non-secret query), e.g. "GET /v2/cryptocurrency/quotes/latest?symbol=BNB,USDT&convert=USD". */
  endpoint: string;
  at: string;
  status: number | null;
  ok: boolean;
  ms: number;
  /** Short, non-secret note: an error message, a request/credit id, "cache hit" etc. */
  note?: string;
}

const RING = 200;
const ring: SponsorCall[] = [];

/** Directory of the append-only call log (gitignored): web/.sponsor-logs by default. */
export function sponsorLogDir(env: Env = process.env): string {
  return env.SPONSOR_LOG_DIR ? path.resolve(env.SPONSOR_LOG_DIR) : path.join(process.cwd(), ".sponsor-logs");
}

function writesToDisk(env: Env) {
  return !env.VITEST && env.SPONSOR_LOG_DISABLE !== "1" && !onCloudflare();
}

/** On Cloudflare Workers (no disk, memory per isolate) the log is a bounded list in the KeyEscrowState Durable Object. */
const SHARED_KEEP = 50;
const sharedKey = (sponsor: SponsorCall["sponsor"]) => `sponsor-log:${sponsor}`;

/** Record a call in memory and in web/.sponsor-logs/<sponsor>.jsonl (judges' evidence of live calls). */
export async function logSponsorCall(call: SponsorCall, env: Env = process.env): Promise<void> {
  ring.push(call);
  if (ring.length > RING) ring.splice(0, ring.length - RING);
  const line = `${JSON.stringify(call)}\n`;
  console.info(`[sponsor:${call.sponsor}] ${call.endpoint} -> ${call.status ?? "ERR"} in ${call.ms}ms${call.note ? ` (${call.note})` : ""}`);
  if (onCloudflare() && !env.VITEST) {
    try {
      await update<SponsorCall[], void>(getSharedState(), sharedKey(call.sponsor), (cur) => ({ value: [...(cur ?? []), call].slice(-SHARED_KEEP), result: undefined }));
    } catch (err) {
      console.warn("sponsor log write failed", (err as Error).message);
    }
    return;
  }
  if (!writesToDisk(env)) return;
  try {
    const dir = sponsorLogDir(env);
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, `${call.sponsor}.jsonl`), line);
  } catch (err) {
    console.warn("sponsor log write failed", (err as Error).message);
  }
}

/** Most recent calls, newest first: from this process, falling back to the on-disk log after a restart. */
export async function recentSponsorCalls(sponsor: SponsorCall["sponsor"], limit = 20, env: Env = process.env): Promise<SponsorCall[]> {
  const mem = ring.filter((c) => c.sponsor === sponsor);
  if (onCloudflare() && !env.VITEST) {
    try {
      const shared = (await getSharedState().get<SponsorCall[]>(sharedKey(sponsor)))?.value ?? [];
      return shared.slice(-limit).reverse();
    } catch {
      return mem.slice(-limit).reverse();
    }
  }
  if (mem.length >= limit || !writesToDisk(env)) return mem.slice(-limit).reverse();
  try {
    const text = await readFile(path.join(sponsorLogDir(env), `${sponsor}.jsonl`), "utf8");
    const disk = text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SponsorCall);
    return disk.slice(-limit).reverse();
  } catch {
    return mem.slice(-limit).reverse();
  }
}

/** Test helper. */
export function clearSponsorLog() {
  ring.length = 0;
}

/** Strip any query parameter that could carry a secret before logging. */
export function safeEndpoint(method: string, url: URL): string {
  const q = new URLSearchParams(url.search);
  for (const k of [...q.keys()]) if (/key|token|secret|sig/i.test(k)) q.set(k, "***");
  const qs = q.toString();
  return `${method} ${url.pathname}${qs ? `?${decodeURIComponent(qs)}` : ""}`;
}
