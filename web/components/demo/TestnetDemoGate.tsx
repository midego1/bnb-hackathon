"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Notice, PageTitle } from "@/components/ui";
import { fetchTestnetInfo, type TestnetInfo } from "@/lib/demo/testnet";
import { friendlyError } from "@/lib/errors";
import { pageTitle, testnetCopy } from "./copy";
import { DemoRunner } from "./DemoRunner";

/**
 * The live BSC testnet demo (chain 97 builds with NEXT_PUBLIC_DEMO_TESTNET=1). The browser holds no key: it asks the
 * server's demo runner (GET /api/demo-testnet) who plays each role, and the runner signs every transaction. When the
 * server has the runner switched off (no DEMO_TESTNET_RUNNER=1) the route answers 404 and this shows a notice.
 */
export function TestnetDemoGate() {
  const [state, setState] = useState<{ info?: TestnetInfo | null; error?: string }>({});
  useEffect(() => {
    let alive = true;
    fetchTestnetInfo().then(
      (info) => alive && setState({ info }),
      (e) => alive && setState({ error: friendlyError(e) }),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (state.error) return <Blocked>{state.error}</Blocked>;
  if (state.info === undefined) return <p className="text-sm text-subtle">{testnetCopy.loading}</p>;
  if (state.info === null) return <Blocked>{testnetCopy.off}</Blocked>;
  return <DemoRunner testnet={state.info} />;
}

function Blocked({ children }: { children: ReactNode }) {
  return (
    <div>
      <PageTitle title={pageTitle}>{testnetCopy.pageIntro}</PageTitle>
      <Notice kind="warn">{children}</Notice>
    </div>
  );
}
