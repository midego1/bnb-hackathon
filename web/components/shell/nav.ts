import type { DevRole } from "@/lib/devAccounts";
import type { Key } from "@/lib/i18n/t";
import type { IconName } from "./icons";

export type NavItem = {
  href: string;
  /** Dictionary key (en/shell.ts `nav`), rendered with t(). */
  label: Key;
  icon: IconName;
  testId: string;
  /** On the local demo chain, opening this view also switches the demo account to this role. */
  role?: DevRole;
  /** Tooltip key, when it should say more than the label. */
  title?: Key;
  prefetch?: false;
};

export type NavGroup = { id: string; label: Key; items: NavItem[] };

/** The guided demo exists only in local anvil builds and the live BSC testnet demo build (see app/(app)/demo/page.tsx). */
export const demoAvailable =
  process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" ||
  (process.env.NEXT_PUBLIC_DEMO_TESTNET === "1" && process.env.NEXT_PUBLIC_CHAIN_ID === "97");

/** The sidebar's groups. "Roles" is the role switcher: the four views plus the dispute desk. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "roles",
    label: "nav.roles",
    items: [
      { href: "/tenant", label: "nav.renter", icon: "renter", testId: "view-tenant", role: "tenant" },
      { href: "/app/subscriptions", label: "nav.subscriptions", icon: "subscriptions", testId: "view-subscriptions", role: "tenant" },
      { href: "/landlord", label: "nav.owner", icon: "owner", testId: "view-landlord", role: "landlord" },
      { href: "/shareholders", label: "nav.shareholders", icon: "shareholders", testId: "view-shareholders", role: "investor" },
      { href: "/backoffice", label: "nav.backoffice", icon: "backoffice", testId: "view-backoffice" },
      { href: "/arbiter", label: "nav.desk", icon: "dispute", testId: "view-arbiter", role: "arbiter" },
    ],
  },
  {
    id: "demo",
    label: "nav.demo",
    items: [
      ...(demoAvailable ? [{ href: "/demo", label: "nav.play", icon: "play", testId: "nav-demo" } as const] : []),
      { href: "/how-it-works", label: "nav.how", icon: "explain", testId: "nav-eli5" },
    ],
  },
  {
    id: "build",
    label: "nav.build",
    items: [
      { href: "/developers", label: "nav.developers", icon: "developers", testId: "nav-developers" },
      { href: "/integrations", label: "nav.integrations", icon: "integrations", testId: "nav-integrations" },
    ],
  },
];

/**
 * The write-only secrets page. The sidebar shows it only when this server runs with SETTINGS_SECRETS_ENABLED=1 (local
 * paseo-box units, never Cloudflare): components/SettingsGear.tsx decides at request time and the layout passes it in.
 */
export const SETTINGS_ITEM: NavItem = {
  href: "/settings/secrets",
  label: "nav.settings",
  icon: "settings",
  testId: "sidebar-settings",
  title: "nav.settingsTitle",
  prefetch: false,
};

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");
