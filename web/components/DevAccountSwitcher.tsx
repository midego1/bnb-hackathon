"use client";

import Link from "next/link";
import { useAccount, useConnect } from "wagmi";
import { DEV_CONNECTOR_ID, devAccounts, setDevRole, type DevRole } from "@/lib/devAccounts";
import { useDeployment } from "@/lib/hooks/useDeployment";

const roles: DevRole[] = ["landlord", "tenant", "arbiter", "investor"];
const roleLabel: Record<DevRole, string> = { landlord: "Owner", tenant: "Renter", arbiter: "Dispute desk", investor: "Shareholder" };

/**
 * Local-only helper bar: act as the anvil owner / renter / arbiter without a browser wallet.
 * Renders nothing unless built with NEXT_PUBLIC_DEV_ACCOUNTS=1 and the active chain is anvil (31337).
 */
export function DevAccountSwitcher() {
  // Inlined env check: constant-folded at build time, so production bundles contain none of this.
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1") return null;
  return <Switcher />;
}

function Switcher() {
  const { chainId } = useDeployment();
  const { address, connector } = useAccount();
  const { connectors, connectAsync } = useConnect();
  if (chainId !== 31337) return null;

  const usingDev = connector?.id === DEV_CONNECTOR_ID;
  const active = usingDev && address ? roles.find((r) => devAccounts[r].toLowerCase() === address.toLowerCase()) : undefined;

  async function pick(r: DevRole) {
    setDevRole(r);
    if (!usingDev) {
      const dev = connectors.find((c) => c.id === DEV_CONNECTOR_ID);
      if (dev) await connectAsync({ connector: dev });
    }
  }

  return (
    <div className="border-b border-warning-border bg-warning-soft text-warning-fg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2 text-xs">
        <span className="font-semibold">Demo accounts</span>
        <span className="hidden opacity-70 sm:inline">local anvil only · act as</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Act as">
          {roles.map((r) => (
            <button
              key={r}
              data-testid={`dev-role-${r}`}
              aria-pressed={active === r}
              onClick={() => pick(r)}
              className={`rounded-md px-2.5 py-1 font-medium ring-1 ring-inset ring-amber-300 transition dark:ring-amber-800 ${
                active === r ? "bg-amber-900 text-amber-50 dark:bg-amber-200 dark:text-amber-950" : "hover:bg-amber-100 dark:hover:bg-amber-900"
              }`}
            >
              {roleLabel[r]}
            </button>
          ))}
        </div>
        {!active && <span className="opacity-70">Pick a role to start</span>}
        <Link href="/demo" className="ml-auto font-semibold underline-offset-2 hover:underline" data-testid="dev-play-demo">
          ▶ Play the demo
        </Link>
      </div>
    </div>
  );
}
