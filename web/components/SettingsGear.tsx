import Link from "next/link";
import { connection } from "next/server";
import { SettingsNavLink } from "@/components/shell/AppShell";
import { settingsSecretsEnabled } from "@/lib/secretsDeployGuard";

/**
 * Link to /settings/secrets, rendered only when this server runs with SETTINGS_SECRETS_ENABLED=1: the sidebar's Settings
 * row (default) and a footer link.
 */
export async function SettingsGear({ variant = "sidebar" }: { variant?: "sidebar" | "footer" }) {
  await connection(); // runtime env, not the build's
  if (!settingsSecretsEnabled(process.env)) return null;
  if (variant === "footer") {
    return (
      <Link href="/settings/secrets" prefetch={false} data-testid="footer-settings" className="underline-offset-2 hover:underline">
        Secrets (local only)
      </Link>
    );
  }
  return <SettingsNavLink />;
}
