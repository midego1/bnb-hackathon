import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

/**
 * The caller's IP, for rate limits. Cloudflare sets cf-connecting-ip on every public request (a client cannot forge it);
 * x-forwarded-for only counts without it: behind a local proxy, or on this Worker's own service-binding calls.
 */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "local";
}

/** Compact, client-friendly list of zod issues. */
export function zodIssues(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/**
 * The origin the caller used (for absolute URLs in an answer). Next's `request.url` names the server's own bind address
 * (http://localhost:3000 behind `next start -H 127.0.0.1`); the Host header is the address the caller typed.
 */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  if (!host) return url.origin;
  try {
    return new URL(`${url.protocol}//${host}`).origin;
  } catch {
    return url.origin; // a malformed Host header
  }
}
