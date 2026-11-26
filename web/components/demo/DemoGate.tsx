"use client";

import type { ReactNode } from "react";
import { Notice, PageTitle } from "@/components/ui";
import { targetChainId } from "@/lib/chains";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";
import { demoCopy } from "./copy";
import { DemoRunner } from "./DemoRunner";

/** The guided demo only runs on the local anvil chain (31337) with the dev account switcher compiled in. */
export function DemoGate() {
  const { chainId, deployment } = useDeployment();
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS !== "1" || targetChainId !== 31337) {
    return <Blocked>The one-click demo only runs on a local anvil build (NEXT_PUBLIC_CHAIN_ID=31337, NEXT_PUBLIC_DEV_ACCOUNTS=1).</Blocked>;
  }
  if (chainId !== 31337) {
    return <Blocked>Your wallet is on another network. Pick a role in the yellow Demo accounts bar (or switch to Anvil) to run the demo.</Blocked>;
  }
  if (!deployment) {
    return <Blocked>KeyScrow is not deployed on this anvil yet. Run <code>pnpm chain:deploy</code> (and <code>pnpm chain:seed</code>) first.</Blocked>;
  }
  return <DemoRunner />;
}

function Blocked({ children }: { children: ReactNode }) {
  const { pageIntro, pageTitle } = useT().of(demoCopy);
  return (
    <div>
      <PageTitle title={pageTitle}>{pageIntro}</PageTitle>
      <Notice kind="warn">{children}</Notice>
    </div>
  );
}
