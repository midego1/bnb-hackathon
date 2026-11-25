"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { DevAccountSwitcher } from "./DevAccountSwitcher";
import { LogoMark } from "./LogoMark";
import { PriceSourceBadge } from "./ui";

const nav = [
  { href: "/landlord", label: "Landlord" },
  { href: "/tenant", label: "Tenant" },
  { href: "/arbiter", label: "Dispute desk" },
];

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
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
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 text-sm sm:hidden">
        <NavLinks />
        <span className="ml-auto shrink-0">
          <PriceSourceBadge />
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
      className={`rounded-lg px-3 py-1.5 transition ${
        active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </Link>
  );
}
