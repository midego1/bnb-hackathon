import { connection } from "next/server";
import { SecretValueError } from "@/lib/server/secrets/envFile";
import { limiters } from "@/lib/server/secrets/guard";
import { body, guard, json, locked } from "@/lib/server/secrets/http";
import { SecretNameError, testStoredOrTyped } from "@/lib/server/secrets/service";

/**
 * POST /api/settings/secrets/test {name}          tests the STORED value of an allowlisted name
 * POST /api/settings/secrets/test {name, value}   tests a typed value without writing it
 * One free, read-only call per test (10 s timeout), 10 tests per 5 minutes. The answer is
 * {status: valid|invalid|untestable, reason, testedAt}: never the value.
 */
export async function POST(req: Request) {
  await connection();
  const ctx = await guard(req, { write: true });
  if (ctx instanceof Response) return ctx;
  if (!ctx.authed) return locked();
  if (!limiters().test.take(ctx.ip ?? "?")) return json({ error: "Too many tests. Wait a few minutes." }, 429, { "Retry-After": "300" });
  const b = await body(req);
  if (!b || typeof b.name !== "string" || (b.value !== undefined && typeof b.value !== "string")) return json({ error: "Bad request." }, 400);
  try {
    return json(await testStoredOrTyped(ctx.cfg, b.name, b.value, ctx.ip));
  } catch (e) {
    if (e instanceof SecretNameError) return json({ error: "This name cannot be tested here." }, 400);
    if (e instanceof SecretValueError) {
      return json({ name: b.name, source: "typed", status: "invalid", reason: e.message.replace(/\.$/, ""), testedAt: new Date().toISOString() });
    }
    console.warn("[settings/secrets] test failed"); // no details, never the value
    return json({ error: "Could not run the test." }, 500);
  }
}
