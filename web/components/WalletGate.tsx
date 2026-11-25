"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { chainName } from "@/lib/chains";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { Notice } from "./ui";

/** Renders children only with a connected wallet on a chain where KeyEscrow is deployed. */
export function WalletGate({ children, what }: { children: ReactNode; what: string }) {
  const { isConnected } = useAccount();
  const { chainId, deployment } = useDeployment();
  if (!isConnected) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-slate-300 p-6 dark:border-slate-700">
        <p className="text-sm">Connect a wallet to {what}.</p>
        <ConnectButton />
        {process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" && chainId === 31337 && (
          <p className="text-xs text-slate-500">Local demo: pick a role in the yellow &ldquo;Anvil dev accounts&rdquo; bar instead.</p>
        )}
      </div>
    );
  }
  if (!deployment) {
    return (
      <Notice kind="warn">
        KeyEscrow is not deployed on {chainName(chainId)} yet. Switch your wallet to the local Anvil chain or BSC testnet.
      </Notice>
    );
  }
  return <>{children}</>;
}
