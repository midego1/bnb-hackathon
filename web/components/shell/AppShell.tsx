"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useConnect } from "wagmi";
import { DevAccountSwitcher } from "@/components/DevAccountSwitcher";
import { LangSwitch } from "@/components/LangSwitch";
import { LogoMark } from "@/components/LogoMark";
import { ThemeCycleButton, ThemeSwitch } from "@/components/ThemeSwitch";
import { PriceSourceBadge } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { DEV_CONNECTOR_ID, setDevRole, type DevRole } from "@/lib/devAccounts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { getSidebarSnapshot, setSidebar, subscribeSidebar, syncSidebarToRoute } from "@/lib/sidebar";
import { Icon } from "./icons";
import { isActive, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "./nav";
import { WalletButton } from "./WalletButton";

/**
 * The app shell: a left sidebar (navigation, theme, network and wallet) beside the page.
 *
 * Desktop (lg and up): the sidebar floats, a sticky rounded panel inset 12 px from the window edges (my-3 ml-3, its
 * height is the viewport minus those margins), expanded or collapsed to an icon rail (lib/sidebar.ts;
 * <html data-sidebar> and the `rail:` CSS variant). Below lg: a top bar whose menu button opens the same sidebar as a
 * drawer. The page column holds the local demo-accounts strip, <main> and the footer; the document itself scrolls,
 * except on the one-screen stages (/demo, /how-it-works), where app/globals.css pins the shell to the viewport.
 */
/** `settings`: the Settings entry (a server component that renders nothing unless the secrets page is on). */
export function AppShell({ children, footer, settings }: { children: ReactNode; footer: ReactNode; settings?: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const t = useT();
  return (
    <div data-app-shell className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t("skip")}
      </a>
      {drawerOpen && <button type="button" aria-label={t("shell.closeMenu")} tabIndex={-1} className="fixed inset-0 z-40 bg-overlay/40 lg:hidden" onClick={closeDrawer} />}
      <Sidebar drawerOpen={drawerOpen} closeDrawer={closeDrawer} settings={settings} />
      <div data-app-content className="flex min-w-0 flex-1 flex-col max-sm:pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <MobileBar menuOpen={drawerOpen} openMenu={() => setDrawerOpen(true)} />
        <DevAccountSwitcher />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        {footer}
      </div>
      {/* The URL is only known at request time: stream the route-dependent bits in. */}
      <Suspense fallback={null}>
        <RouteSync setDrawerOpen={setDrawerOpen} />
      </Suspense>
    </div>
  );
}

/** On every client-side navigation: close the phone drawer and give the sidebar the state of the new page. */
function RouteSync({ setDrawerOpen }: { setDrawerOpen: (open: boolean) => void }) {
  const pathname = usePathname();
  const shownPath = useRef<string | null>(null);
  useEffect(() => {
    syncSidebarToRoute(pathname);
    // Close the drawer on navigation only: this boundary can hydrate after the menu button, and closing on its first
    // run would shut a drawer the visitor has just opened.
    if (shownPath.current !== null && shownPath.current !== pathname) setDrawerOpen(false);
    shownPath.current = pathname;
  }, [pathname, setDrawerOpen]);
  return null;
}

function Sidebar({ drawerOpen, closeDrawer, settings }: { drawerOpen: boolean; closeDrawer: () => void; settings?: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => "expanded" as const) === "collapsed";
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = useT();

  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  return (
    <aside
      id="app-sidebar"
      aria-label={t("shell.sidebar")}
      data-testid="sidebar"
      data-collapsed={collapsed || undefined}
      className={`${drawerOpen ? "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shadow-xl" : "hidden"} shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-3 lg:z-auto lg:my-3 lg:ml-3 lg:flex lg:h-[calc(100dvh-1.5rem)] lg:w-56 lg:max-w-none lg:rounded-xl lg:border lg:shadow-sidebar rail:w-16`}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3 rail:h-auto rail:flex-col rail:gap-2 rail:py-3">
        <Link href="/app" className="relative flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-lg font-semibold tracking-tight" title="KeyScrow">
          <LogoMark />
          <span className="truncate rail:sr-only">KeyScrow</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebar(collapsed ? "expanded" : "collapsed", window.location.pathname)}
          aria-label={collapsed ? t("shell.expand") : t("shell.collapse")}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          title={collapsed ? t("shell.expand") : t("shell.collapse")}
          data-testid="sidebar-toggle"
          className="ml-auto hidden text-subtle hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-transparent aria-expanded:text-subtle aria-expanded:hover:bg-sidebar-accent aria-expanded:hover:text-sidebar-accent-foreground lg:inline-flex rail:ml-0 dark:hover:bg-sidebar-accent"
        >
          <Icon name="rail" />
        </Button>
        <Button
          ref={closeRef}
          variant="ghost"
          size="icon"
          onClick={closeDrawer}
          aria-label={t("shell.closeMenu")}
          className="ml-auto text-subtle hover:bg-sidebar-accent lg:hidden dark:hover:bg-sidebar-accent"
        >
          <Icon name="close" />
        </Button>
      </div>

      <nav aria-label={t("shell.main")} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((g) => (
          <div key={g.id} className="mb-3 last:mb-0 rail:mb-2 rail:border-b rail:border-sidebar-border rail:pb-2 rail:last:border-0">
            <p id={`nav-${g.id}`} className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase rail:sr-only">
              {t(g.label)}
            </p>
            <ul aria-labelledby={`nav-${g.id}`} className="flex flex-col gap-0.5" data-testid={g.id === "roles" ? "role-switcher" : `nav-group-${g.id}`}>
              <NavLinks items={g.items} />
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-sidebar-border px-3 py-3">
        {settings}
        <div className="flex items-center justify-between gap-2 px-1 rail:flex-col rail:px-0">
          <ThemeSwitch className="inline-flex rail:flex-col" />
          <PriceSourceBadge className="rail:hidden" />
        </div>
        {/* Too wide for the icon rail: expand the sidebar to switch. */}
        <LangSwitch className="inline-flex self-start border-border text-xs rail:hidden" />
        <WalletButton />
      </div>
    </aside>
  );
}

/** The sidebar's Settings row; components/SettingsGear.tsx renders it only when the secrets page is on. */
export function SettingsNavLink() {
  return (
    <ul className="flex flex-col empty:hidden">
      <NavLinks items={[SETTINGS_ITEM]} />
    </ul>
  );
}

/** The current page's item is highlighted (aria-current); that needs the URL, so it streams in. */
function NavLinks({ items }: { items: NavItem[] }) {
  const plain = items.map((item) => <NavLink key={item.href} item={item} active={false} />);
  return (
    <Suspense fallback={plain}>
      <ActiveNavLinks items={items} />
    </Suspense>
  );
}

function ActiveNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return items.map((item) => <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const switchRole = useDevRoleSwitch();
  const t = useT();
  const label = t(item.label);
  return (
    <li>
      <Link
        href={item.href}
        prefetch={item.prefetch}
        onClick={() => item.role && switchRole?.(item.role)}
        data-testid={item.testId}
        aria-current={active ? "page" : undefined}
        title={item.title ? t(item.title) : label}
        className={`relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-ring rail:justify-center rail:px-0 ${
          active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon name={item.icon} />
        <span className="truncate rail:sr-only">{label}</span>
      </Link>
    </li>
  );
}

/** Phones and tablets: logo, rates, theme, and the menu button that opens the sidebar as a drawer (below the notch). */
function MobileBar({ menuOpen, openMenu }: { menuOpen: boolean; openMenu: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 lg:hidden" data-testid="mobile-nav">
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={openMenu}
        aria-label={t("shell.openMenu")}
        aria-controls="app-sidebar"
        aria-expanded={menuOpen}
        data-testid="menu-open"
        className="-ml-1"
      >
        <Icon name="menu" className="size-5" />
      </Button>
      <Link href="/app" className="flex min-h-11 min-w-11 items-center gap-2 text-base font-semibold tracking-tight">
        <LogoMark className="h-6 w-6 shrink-0" />
        <span className="truncate">KeyScrow</span>
      </Link>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <PriceSourceBadge />
        <ThemeCycleButton className="inline-flex" />
      </span>
    </div>
  );
}

/** Local demo only: switch the anvil demo account along with the view. Undefined (no-op) everywhere else. */
function useDevRoleSwitch(): ((role: DevRole) => void) | undefined {
  const { chainId } = useDeployment();
  const { connector } = useAccount();
  const { connectors, connectAsync } = useConnect();
  // Inlined env check: constant-folded at build time.
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1" || chainId !== 31337) return undefined;
  // A real wallet connected to the local chain keeps its account.
  if (connector && connector.id !== DEV_CONNECTOR_ID) return undefined;
  return (role) => {
    setDevRole(role);
    if (!connector) {
      const dev = connectors.find((c) => c.id === DEV_CONNECTOR_ID);
      if (dev) void connectAsync({ connector: dev }).catch(() => {});
    }
  };
}
