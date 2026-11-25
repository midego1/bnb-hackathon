import Link from "next/link";
import { connection } from "next/server";
import { settingsSecretsEnabled } from "@/lib/secretsDeployGuard";

/**
 * Link to /settings/secrets, rendered only when this server runs with SETTINGS_SECRETS_ENABLED=1. The header gear shows
 * from 1400px up only (at 1280 the header has no room and /demo must not scroll sideways); the footer link always.
 */
export async function SettingsGear({ variant = "header" }: { variant?: "header" | "footer" }) {
  await connection(); // runtime env, not the build's
  if (!settingsSecretsEnabled(process.env)) return null;
  if (variant === "footer") {
    return (
      <Link href="/settings/secrets" prefetch={false} data-testid="footer-settings" className="underline-offset-2 hover:underline">
        Secrets (local only)
      </Link>
    );
  }
  return (
    <Link
      href="/settings/secrets"
      prefetch={false}
      aria-label="Secrets settings"
      title="Secrets settings (local only)"
      data-testid="header-settings"
      className="hidden size-9 shrink-0 min-[1400px]:inline-flex items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    </Link>
  );
}
