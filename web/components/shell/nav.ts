import type { DevRole } from "@/lib/devAccounts";
import type { IconName } from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  testId: string;
  /** On the local demo chain, opening this view also switches the demo account to this role. */
  role?: DevRole;
  /** Tooltip, when it should say more than the label. */
  title?: string;
  prefetch?: false;
};

export type NavGroup = { id: string; label: string; items: NavItem[] };

/** The guided demo exists only in local anvil builds and the live BSC testnet demo build (see app/(app)/demo/page.tsx). */
export const demoAvailable =
  process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" ||
  (process.env.NEXT_PUBLIC_DEMO_TESTNET === "1" && process.env.NEXT_PUBLIC_CHAIN_ID === "97");

/** The sidebar's groups. "Roles" is the role switcher: the four views plus the dispute desk. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "roles",
    label: "Roles",
    items: [
      { href: "/tenant", label: "Renter", icon: "renter", testId: "view-tenant", role: "tenant" },
      { href: "/app/subscriptions", label: "Subscriptions", icon: "subscriptions", testId: "view-subscriptions", role: "tenant" },
      { href: "/landlord", label: "Fleet owner", icon: "owner", testId: "view-landlord", role: "landlord" },
      { href: "/shareholders", label: "Shareholders", icon: "shareholders", testId: "view-shareholders", role: "investor" },
      { href: "/backoffice", label: "Back office", icon: "backoffice", testId: "view-backoffice" },
      { href: "/arbiter", label: "Dispute desk", icon: "dispute", testId: "view-arbiter", role: "arbiter" },
    ],
  },
  {
    id: "demo",
    label: "Demo",
    items: [
      ...(demoAvailable ? [{ href: "/demo", label: "Play the demo", icon: "play", testId: "nav-demo" } as const] : []),
      { href: "/how-it-works", label: "How it works", icon: "explain", testId: "nav-eli5" },
    ],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { href: "/developers", label: "Developers", icon: "developers", testId: "nav-developers" },
      { href: "/integrations", label: "Integrations", icon: "integrations", testId: "nav-integrations" },
    ],
  },
];

/**
 * The write-only secrets page. The sidebar shows it only when this server runs with SETTINGS_SECRETS_ENABLED=1 (local
 * paseo-box units, never Cloudflare): components/SettingsGear.tsx decides at request time and the layout passes it in.
 */
export const SETTINGS_ITEM: NavItem = {
  href: "/settings/secrets",
  label: "Settings",
  icon: "settings",
  testId: "sidebar-settings",
  title: "Secrets settings (local only)",
  prefetch: false,
};

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");
