"use client";

import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { ActionButton } from "@/components/ui";
import { planBnbSwap, quoteTrusted, routerAbi, swapRoute } from "@/lib/atlas";
import { TOKEN } from "@/lib/contracts";
import { formatUsdt } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import type { LeaseData } from "@/lib/hooks/useLease";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { usePrices } from "@/lib/usePrices";

/**
 * Renter: swap BNB into the escrow stablecoin for what is still missing, guarded by Atlas. amountOutMin is 99 % of
 * the Atlas BNB/USD value; it refuses when Atlas is stale or its consensus is not HEALTHY/DEGRADED, and when the pool
 * quote is more than 2 % away from Atlas. BSC mainnet: PancakeSwap V2. Testnet/anvil: the AtlasSwapGuard demo swap.
 * Approve + fund stay the usual buttons.
 */
export function PayWithBnb({ lease, short }: { lease: LeaseData; short: bigint | undefined }) {
  const { address } = useAccount();
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  const { prices } = usePrices();
  const { send, pending } = useTx();
  const t = useT();
  const route = chainId ? swapRoute(chainId, lease.terms.token, deployment?.atlasSwapGuard) : null;
  const plan = planBnbSwap(short ?? BigInt(0), TOKEN.decimals, prices?.atlas, chainId ?? 0);
  const quote = useQuery({
    queryKey: ["bnb-quote", chainId, route?.router, plan.ok ? plan.bnbIn.toString() : null],
    enabled: !!client && !!route && plan.ok && !!short,
    queryFn: async () => (await client!.readContract({ address: route!.router, abi: routerAbi, functionName: "getAmountsOut", args: [plan.ok ? plan.bnbIn : BigInt(0), [...route!.path]] }))[1],
  });
  if (!route) return null;

  const label = t("rental.fund.bnb.tx");
  const untrusted = (why: string) => t("rental.fund.bnb.untrusted", { why });
  const why =
    short === undefined
      ? t("rental.fund.loadingBalance")
      : short === BigInt(0)
      ? t("rental.fund.bnb.enough")
      : !plan.ok
        ? plan.why === "cap"
          ? t("rental.fund.bnb.cap")
          : untrusted(prices?.atlas?.reason ?? t("rental.fund.bnb.noAtlas"))
        : quote.isError
          ? untrusted(t("rental.fund.bnb.noQuote"))
          : quote.data === undefined
            ? t("rental.fund.bnb.quoting")
            : !quoteTrusted(quote.data, plan.atlasOut)
              ? untrusted(t("rental.fund.bnb.deviation"))
              : null;
  return (
    <div className="mt-4 rounded-xl border border-border p-3" data-testid="pay-bnb-box">
      <p className="mb-2 text-xs text-muted-foreground">{t(route.pancake ? "rental.fund.bnb.notePancake" : "rental.fund.bnb.noteGuard")}</p>
      {plan.ok && !!short && (
        <p className="mb-2 text-xs text-subtle tabular-nums" data-testid="pay-bnb-min">
          {t("rental.fund.bnb.min", { bnb: Number(formatEther(plan.bnbIn)).toFixed(6), min: formatUsdt(plan.amountOutMin), price: prices?.atlas?.bnbUsd?.toFixed(2) ?? "?" })}
        </p>
      )}
      <ActionButton
        variant="secondary"
        busy={pending === label}
        disabledReason={why}
        onClick={() =>
          plan.ok &&
          send(label, {
            address: route.router,
            abi: routerAbi,
            functionName: "swapExactETHForTokens",
            args: [plan.amountOutMin, [...route.path], address!, BigInt(Math.floor(Date.now() / 1000) + 600)],
            value: plan.bnbIn,
          })
        }
        data-testid="pay-bnb"
      >
        {t("rental.fund.bnb.button", { amount: formatUsdt(short ?? BigInt(0)) })}
      </ActionButton>
    </div>
  );
}
