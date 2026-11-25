"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useConnect } from "wagmi";
import { AskAiEntry } from "@/components/assistant/AskAiEntry";
import { DevAccountSwitcher } from "@/components/DevAccountSwitcher";
import { LogoMark } from "@/components/LogoMark";
import { ThemeCycleButton, ThemeSwitch } from "@/components/ThemeSwitch";
import { PriceSourceBadge } from "@/components/ui";
import { DEV_CONNECTOR_ID, setDevRole, type DevRole } from "@/lib/devAccounts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { getSidebarSnapshot, setSidebar, subscribeSidebar, syncSidebarToRoute } from "@/lib/sidebar";
import { Icon } from "./icons";
import { isActive, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "./nav";
import { WalletButton } from "./WalletButton";

/**
 * The app shell: a left sidebar (navigation, theme, network and wallet) beside the page.
 *
 * Desktop (lg and up): the sidebar is sticky and full height, expanded or collapsed to an icon rail (lib/sidebar.ts;
 * <html data-sidebar> and the `rail:` CSS variant). Below lg: a top bar whose menu button opens the same sidebar as a
 * drawer. The page column holds the local demo-accounts strip, <main> and the footer; the document itself scrolls,
 * except on the one-screen stages (/demo, /how-it-works), where app/globals.css pins the shell to the viewport.
 */
/** `settings`: the Settings entry (a server component that renders nothing unless the secrets page is on). */
export function AppShell({ children, footer, settings }: { children: ReactNode; footer: ReactNode; settings?: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  return (
    <div data-app-shell className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground"
      >
        Skip to content
      </a>
      {drawerOpen && <button type="button" aria-label="Close menu" tabIndex={-1} className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={closeDrawer} />}
      <Sidebar drawerOpen={drawerOpen} closeDrawer={closeDrawer} settings={settings} />
      <div data-app-content className="flex min-w-0 flex-1 flex-col">
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
  useEffect(() => {
    syncSidebarToRoute(pathname);
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);
  return null;
}

function Sidebar({ drawerOpen, closeDrawer, settings }: { drawerOpen: boolean; closeDrawer: () => void; settings?: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => "expanded" as const) === "collapsed";
  const closeRef = useRef<HTMLButtonElement>(null);

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
      aria-label="Sidebar"
      data-testid="sidebar"
      data-collapsed={collapsed || undefined}
      className={`${drawerOpen ? "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shadow-xl" : "hidden"} shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-border bg-surface lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:w-56 lg:max-w-none lg:shadow-none rail:w-16`}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3 rail:h-auto rail:flex-col rail:gap-2 rail:py-3">
        <Link href="/" className="relative flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-lg font-semibold tracking-tight" title="KeyEscrow">
          <LogoMark />
          <span className="truncate rail:sr-only">KeyEscrow</span>
        </Link>
        <button
          type="button"
          onClick={() => setSidebar(collapsed ? "expanded" : "collapsed", window.location.pathname)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-toggle"
          className="ml-auto hidden h-8 w-8 items-center justify-center rounded-lg text-subtle transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent lg:inline-flex rail:ml-0"
        >
          <Icon name="rail" />
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={closeDrawer}
          aria-label="Close menu"
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent lg:hidden"
        >
          <Icon name="close" />
        </button>
      </div>

      {/* Ask AI: opens the assistant panel (also Cmd+J / Ctrl+J); on a phone the drawer closes first. */}
      <div id="ask-ai-slot" data-ask-ai-slot className="shrink-0 px-3 empty:hidden">
        <AskAiEntry onOpen={closeDrawer} />
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((g) => (
          <div key={g.id} className="mb-3 last:mb-0 rail:mb-2 rail:border-b rail:border-border rail:pb-2 rail:last:border-0">
            <p id={`nav-${g.id}`} className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase rail:sr-only">
              {g.label}
            </p>
            <ul aria-labelledby={`nav-${g.id}`} className="flex flex-col gap-0.5" data-testid={g.id === "roles" ? "role-switcher" : `nav-group-${g.id}`}>
              <NavLinks items={g.items} />
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-3">
        {settings}
        <div className="flex items-center justify-between gap-2 px-1 rail:flex-col rail:px-0">
          <ThemeSwitch className="inline-flex rail:flex-col" />
          <PriceSourceBadge className="rail:hidden" />
        </div>
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
  return (
    <li>
      <Link
        href={item.href}
        prefetch={item.prefetch}
        onClick={() => item.role && switchRole?.(item.role)}
        data-testid={item.testId}
        aria-current={active ? "page" : undefined}
        title={item.title ?? item.label}
        className={`relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rail:justify-center rail:px-0 ${
          active ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-muted hover:text-foreground"
        }`}
      >
        <Icon name={item.icon} />
        <span className="truncate rail:sr-only">{item.label}</span>
      </Link>
    </li>
  );
}

/** Phones and tablets: logo, rates, theme, and the menu button that opens the sidebar as a drawer. */
function MobileBar({ menuOpen, openMenu }: { menuOpen: boolean; openMenu: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2 lg:hidden" data-testid="mobile-nav">
      <button
        type="button"
        onClick={openMenu}
        aria-label="Open menu"
        aria-controls="app-sidebar"
        aria-expanded={menuOpen}
        data-testid="menu-open"
        className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>
      <Link href="/" className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
        <LogoMark className="h-6 w-6" />
        KeyEscrow
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
