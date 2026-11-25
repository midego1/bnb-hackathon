"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useConnect } from "wagmi";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { DevAccountSwitcher } from "./DevAccountSwitcher";
import { DEV_CONNECTOR_ID, setDevRole, type DevRole } from "@/lib/devAccounts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { LogoMark } from "./LogoMark";
import { ThemeCycleButton, ThemeSwitch } from "./ThemeSwitch";
import { PriceSourceBadge } from "./ui";

/**
 * Role switcher: the four demo views plus the dispute desk. On the local demo chain picking a view also switches
 * the demo account to that role (see DevAccountSwitcher); with a real wallet it is plain navigation.
 */
const nav: { href: string; label: string; role?: DevRole }[] = [
  { href: "/backoffice", label: "Back office" },
  { href: "/tenant", label: "Renter", role: "tenant" },
  { href: "/landlord", label: "Fleet owner", role: "landlord" },
  { href: "/shareholders", label: "Shareholders", role: "investor" },
  { href: "/arbiter", label: "Dispute desk", role: "arbiter" },
];

export function Header() {
  return (
    <header className="border-b border-border bg-surface">
      <DevAccountSwitcher />
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <LogoMark />
          KeyEscrow
        </Link>
        <nav className="hidden gap-1 text-sm md:flex" aria-label="View as" data-testid="role-switcher">
          <NavLinks />
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden xl:block">
            <PriceSourceBadge />
          </span>
          <ThemeSwitch className="hidden md:inline-flex" />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 text-sm md:hidden" data-testid="mobile-nav" aria-label="View as">
        <NavLinks />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <PriceSourceBadge />
          <ThemeCycleButton className="inline-flex" />
        </span>
      </nav>
    </header>
  );
}

/** The active-tab highlight needs the URL, which is only known at request time: stream it in. */
function NavLinks() {
  const plain = nav.map((item) => <NavLink key={item.href} {...item} active={false} />);
  return (
    <Suspense fallback={plain}>
      <ActiveNavLinks />
    </Suspense>
  );
}

function ActiveNavLinks() {
  const pathname = usePathname();
  return nav.map((item) => <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} />);
}

function NavLink({ href, label, active, role }: { href: string; label: string; active: boolean; role?: DevRole }) {
  const switchRole = useDevRoleSwitch();
  return (
    <Link
      href={href}
      onClick={() => role && switchRole?.(role)}
      data-testid={`view-${href.slice(1)}`}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-2.5 py-1.5 transition sm:px-3 ${
        active ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-muted"
      } shrink-0 whitespace-nowrap`}
    >
      {label}
    </Link>
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
