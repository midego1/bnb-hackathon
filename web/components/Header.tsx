"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { DevAccountSwitcher } from "./DevAccountSwitcher";
import { LogoMark } from "./LogoMark";
import { ThemeCycleButton, ThemeSwitch } from "./ThemeSwitch";
import { PriceSourceBadge } from "./ui";

const nav = [
  { href: "/landlord", label: "Landlord" },
  { href: "/tenant", label: "Tenant" },
  { href: "/arbiter", label: "Dispute desk" },
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
        <nav className="hidden gap-1 text-sm sm:flex">
          <NavLinks />
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden md:block">
            <PriceSourceBadge />
          </span>
          <ThemeSwitch className="hidden sm:inline-flex" />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 text-sm sm:hidden" data-testid="mobile-nav">
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

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-2.5 py-1.5 transition sm:px-3 ${
        active ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-muted"
      }`}
    >
      {label}
    </Link>
  );
}
