import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

/** Compact, client-friendly list of zod issues. */
export function zodIssues(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
