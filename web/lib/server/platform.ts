/**
 * Where the server code runs. Under `next dev` / `next start` it is plain Node.js; on Cloudflare Workers (the
 * OpenNext build, docs/CLOUDFLARE.md) the Worker's bindings are reachable per request through the context OpenNext
 * stores on globalThis. Read through the symbol rather than `getCloudflareContext()` so Node builds never load the
 * adapter.
 */

const CONTEXT = Symbol.for("__cloudflare-context__");

/** The Cloudflare Worker `env` (vars, secrets and bindings) of the current request, or undefined outside Workers. */
export function cloudflareEnv(): Record<string, unknown> | undefined {
  const ctx = (globalThis as Record<symbol, { env?: Record<string, unknown> } | undefined>)[CONTEXT];
  return ctx?.env;
}

/** True on Cloudflare Workers: inside an OpenNext request, or wherever the Worker var KEYESCROW_PLATFORM says so. */
export function onCloudflare(): boolean {
  return cloudflareEnv() !== undefined || process.env.KEYESCROW_PLATFORM === "cloudflare";
}

/** A named binding of the current Worker request (R2 bucket, Durable Object namespace, ...), if bound. */
export function cloudflareBinding<T>(name: string): T | undefined {
  const v = cloudflareEnv()?.[name];
  return v === undefined || v === null || typeof v === "string" ? undefined : (v as T);
}
