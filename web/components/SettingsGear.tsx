import Link from "next/link";
import { connection } from "next/server";
import { SettingsNavLink } from "@/components/shell/AppShell";
import { getDictionary } from "@/lib/i18n/server";
import { settingsSecretsEnabled } from "@/lib/secretsDeployGuard";

/**
 * Link to /settings/secrets, rendered only when this server runs with SETTINGS_SECRETS_ENABLED=1: the sidebar's Settings
 * row (default) and a footer link.
 */
export async function SettingsGear({ variant = "sidebar" }: { variant?: "sidebar" | "footer" }) {
  await connection(); // runtime env, not the build's
  if (!settingsSecretsEnabled(process.env)) return null;
  if (variant === "footer") {
    const t = await getDictionary();
    return (
      <Link href="/settings/secrets" prefetch={false} data-testid="footer-settings" className="underline-offset-2 hover:underline">
        {t("shell.footer.secrets")}
      </Link>
    );
  }
  return <SettingsNavLink />;
}
