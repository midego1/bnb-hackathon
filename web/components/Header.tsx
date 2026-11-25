"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";

const nav = [
  { href: "/landlord", label: "Landlord" },
  { href: "/tenant", label: "Tenant" },
  { href: "/arbiter", label: "Arbiter" },
];

export function Header() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          KeyEscrow
        </Link>
        <nav className="hidden gap-5 text-sm sm:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="opacity-80 hover:opacity-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    </header>
  );
}
