import { NextResponse, type NextRequest } from "next/server";
import { settingsSecretsEnabled } from "@/lib/secretsDeployGuard";
import { checkRequest } from "@/lib/server/secrets/guard";

/**
 * Gate of the write-only secrets page: /settings/secrets and /api/settings/* answer 404 unless the server runs with
 * SETTINGS_SECRETS_ENABLED=1 (local paseo-box units only, never Cloudflare), and 403 outside localhost / the tailnet.
 * The API routes run the same checks again (lib/server/secrets/http.ts).
 */
export function proxy(req: NextRequest) {
  if (!settingsSecretsEnabled(process.env)) return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const write = req.method !== "GET" && req.method !== "HEAD";
  const bad = checkRequest(req, process.env, write);
  if (bad) return new NextResponse(bad.error, { status: bad.status, headers: { "Cache-Control": "no-store" } });
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Frame-Options", "DENY");
  return res;
}

export const config = { matcher: ["/settings/secrets", "/settings/secrets/:path*", "/api/settings/:path*"] };
