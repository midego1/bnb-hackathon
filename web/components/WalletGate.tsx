"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { chainName } from "@/lib/chains";
import { getDeployment } from "@/lib/contracts";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { Notice } from "./ui";

/** Renders children only with a connected wallet on a chain where KeyScrow is deployed. `what`: already in the active language ("see your rentals"). */
export function WalletGate({ children, what }: { children: ReactNode; what: string }) {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { chainId } = useDeployment();
  const t = useT();
  if (!isConnected) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border-strong p-6">
        <p className="text-sm">{t("shell.gate.connect", { what })}</p>
        <ConnectButton />
        {process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" && chainId === 31337 && (
          <p className="text-xs text-subtle">{t("shell.gate.devHint")}</p>
        )}
      </div>
    );
  }
  // Reads fall back to the default chain (useDeployment); writes need the wallet itself on a KeyScrow chain.
  if (!getDeployment(walletChainId)) {
    return (
      <Notice kind="warn">
        {t("shell.gate.notDeployed", { chain: chainName(walletChainId ?? chainId) })}
      </Notice>
    );
  }
  return <>{children}</>;
}
