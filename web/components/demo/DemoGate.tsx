"use client";

import { Notice } from "@/components/ui";
import { targetChainId } from "@/lib/chains";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { DemoRunner } from "./DemoRunner";

/** The guided demo only runs on the local anvil chain (31337) with the dev account switcher compiled in. */
export function DemoGate() {
  const { chainId, deployment } = useDeployment();
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1" || targetChainId !== 31337) {
    return <Notice kind="warn">The one-click demo only runs on a local anvil build (NEXT_PUBLIC_CHAIN_ID=31337, NEXT_PUBLIC_DEV_ACCOUNTS=1).</Notice>;
  }
  if (chainId !== 31337) {
    return <Notice kind="warn">Your wallet is on another network. Pick a role in the yellow Demo accounts bar (or switch to Anvil) to run the demo.</Notice>;
  }
  if (!deployment) {
    return <Notice kind="warn">KeyEscrow is not deployed on this anvil yet. Run <code>pnpm chain:deploy</code> (and <code>pnpm chain:seed</code>) first.</Notice>;
  }
  return <DemoRunner />;
}
