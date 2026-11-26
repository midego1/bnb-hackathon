"use client";

import { demoPersona } from "@/lib/demoPersonas";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useT } from "@/lib/i18n/client";

/** "🇩🇪 Anna · demo persona" next to a wallet of the demo world (pnpm testnet:world); nothing for any other wallet. */
export function DemoPersona({ address }: { address: string | undefined }) {
  const t = useT();
  const { chainId } = useDeployment();
  const p = demoPersona(chainId, address);
  if (!p) return null;
  return (
    <span
      data-testid="demo-persona"
      title={p.persona}
      className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info-fg ring-1 ring-inset ring-info-border"
    >
      {p.flag && <span aria-hidden>{p.flag}</span>}
      {p.name}
      <span className="opacity-75">· {t("ui.demoPersona")}</span>
    </span>
  );
}
