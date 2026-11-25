import { settingsSecretsEnabled } from "@/lib/secretsDeployGuard";
import { checkRequest } from "./guard";

type Env = Record<string, string | undefined>;

/**
 * Whether /settings/secrets may render for this request: the page is on (SETTINGS_SECRETS_ENABLED=1, never on
 * Cloudflare) and the request passes the same network checks as the API (no proxy headers, local/tailnet client and
 * Host, same-origin). The page answers notFound() otherwise; the API routes run their own guard (./http.ts).
 */
export function secretsPageAllowed(headers: Headers, env: Env): boolean {
  if (!settingsSecretsEnabled(env)) return false;
  return checkRequest(new Request("http://localhost/settings/secrets", { headers }), env, false) === null;
}
