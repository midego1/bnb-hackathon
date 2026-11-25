/**
 * The write-only secrets page (/settings/secrets) is for the local paseo-box units only. It is on only with
 * SETTINGS_SECRETS_ENABLED=1, and never on Cloudflare: a Cloudflare build with the flag fails (next.config.ts), and at
 * runtime the flag is ignored there. No imports, so next.config.ts can load this file.
 */

type Env = Record<string, string | undefined>;

/** Cloudflare Pages / Workers Builds set these in their build environment; Workers report this user agent. */
export function onCloudflare(env: Env): boolean {
  if (env.CF_PAGES === "1" || env.WORKERS_CI === "1" || env.CF_PAGES_BRANCH || env.CLOUDFLARE_WORKERS_BUILD) return true;
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export function settingsSecretsEnabled(env: Env): boolean {
  return env.SETTINGS_SECRETS_ENABLED === "1" && !onCloudflare(env);
}

/** Called from next.config.ts: refuses to build a Cloudflare deploy with the secrets page switched on. */
export function assertSecretsPageBuildAllowed(env: Env): void {
  if (env.SETTINGS_SECRETS_ENABLED === "1" && onCloudflare(env)) {
    throw new Error("SETTINGS_SECRETS_ENABLED=1 is refused on Cloudflare builds: the secrets page is local-only (docs/SETUP.md).");
  }
}
