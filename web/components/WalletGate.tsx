"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { chainName } from "@/lib/chains";
import { getDeployment } from "@/lib/contracts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { Notice } from "./ui";

/** Renders children only with a connected wallet on a chain where KeyEscrow is deployed. */
export function WalletGate({ children, what }: { children: ReactNode; what: string }) {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { chainId } = useDeployment();
  if (!isConnected) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border-strong p-6">
        <p className="text-sm">Connect a wallet to {what}.</p>
        <ConnectButton />
        {process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" && chainId === 31337 && (
          <p className="text-xs text-subtle">Local demo: pick Owner, Renter or Dispute desk in the yellow &ldquo;Demo accounts&rdquo; bar instead.</p>
        )}
      </div>
    );
  }
  // Reads fall back to the default chain (useDeployment); writes need the wallet itself on a KeyEscrow chain.
  if (!getDeployment(walletChainId)) {
    return (
      <Notice kind="warn">
        KeyEscrow is not deployed on {chainName(walletChainId ?? chainId)} yet. Switch your wallet to the network this app runs on (local anvil or BSC testnet).
      </Notice>
    );
  }
  return <>{children}</>;
}
