"use client";

import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { viewerRole } from "@/components/lease/model";
import { ActionButton, Card, Notice, PriceSourceBadge, Skeleton } from "@/components/ui";
import { chainName } from "@/lib/chains";
import { mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { formatFiat } from "@/lib/fiat";
import { formatUsdt } from "@/lib/format";
import { useDeployment } from "@/lib/hooks/useDeployment";
import { useLease } from "@/lib/hooks/useLease";
import { useTokenState } from "@/lib/hooks/useToken";
import { useTx } from "@/lib/hooks/useTx";
import { useT } from "@/lib/i18n/client";
import { perIn } from "@/lib/rentals";
import { amountDue, promptPayPayload, QR_TTL_MS, thbFor } from "@/lib/promptpay";
import { usePrices } from "@/lib/usePrices";

// The QR encoder loads in the browser only: no server (Worker) copy of it.
const PromptPayQr = dynamic(() => import("./PromptPayQr"), { ssr: false, loading: () => <Skeleton className="h-56 w-56" /> });

/**
 * DEMO of a fiat on-ramp: the renter "pays" the baht amount by PromptPay QR, the server mints the same value in test
 * mUSDT to their wallet (POST /api/demo-testnet/onramp), then the renter's own wallet approves and funds the escrow.
 */
export function PayWithPromptPay({ address }: { address: Address }) {
  const { address: me } = useAccount();
  const { chainId, deployment } = useDeployment();
  const { data: lease, isLoading, error } = useLease(deployment ? address : undefined);
  const { prices } = usePrices();
  const { data: token } = useTokenState(me, address);
  const { send, pending } = useTx();
  const queryClient = useQueryClient();
  const t = useT();
  const [issuedAt, setIssuedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState(false);
  const [done, setDone] = useState(false);
  const [mintError, setMintError] = useState<string>();
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const banner = (
    <div role="note" className="rounded-xl border-2 border-dashed border-warning-border bg-warning-soft px-4 py-3 text-center text-warning-fg" data-testid="demo-banner">
      <p className="text-lg font-bold uppercase tracking-wide">{t.h("promptpay.banner")}</p>
      <p className="text-sm">{t("promptpay.banner", { chain: chainName(chainId) })}</p>
    </div>
  );
  const page = (body: React.ReactNode) => (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-subtle">
          <Link href={`/lease/${address}`} className="hover:underline">
            {t("promptpay.back")}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t.h("promptpay.title")}</h1>
      </div>
      {banner}
      {body}
    </div>
  );

  if (!deployment) return page(<Notice kind="warn">{t("promptpay.notDeployed", { chain: chainName(chainId) })}</Notice>);
  if (isLoading) return page(<Skeleton className="h-64" />);
  if (error || !lease) return page(<Notice kind="error">{t("promptpay.noRental", { address, chain: chainName(chainId) })}</Notice>);
  if (viewerRole(lease, me) !== "tenant") return page(<Notice kind="warn">{t("promptpay.notRenter")}</Notice>);

  if (done)
    return page(
      <Notice>
        <span data-testid="promptpay-done">{t("promptpay.done")}</span>
        <Link href={`/lease/${address}`} className="font-medium underline">
          {t("promptpay.openRental")}
        </Link>
      </Notice>,
    );

  const due = amountDue(lease);
  if (!due) return page(<Notice>{t("promptpay.nothingDue")}</Notice>);
  const rate = prices?.rates.USDT.THB;
  const baht = rate === undefined ? undefined : thbFor(due.amount, rate);
  const thb = baht && baht > 0 ? baht : undefined; // under half a satang: no QR
  const left = Math.max(0, issuedAt + QR_TTL_MS - now);
  const secs = Math.ceil(left / 1000);
  const allowance = token?.allowance;
  const balance = token?.balance;

  const paid = async () => {
    setMinting(true);
    setMintError(undefined);
    try {
      const res = await fetch("/api/demo-testnet/onramp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease: address }) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error(t("promptpay.onrampOff"));
      if (!res.ok) throw new Error(json.error ?? t("promptpay.onrampStatus", { status: res.status }));
      setMinted(true);
      await queryClient.invalidateQueries();
    } catch (e) {
      setMintError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  };

  const pay = () =>
    send(
      due.what === "fund" ? "Fund escrow" : "Prepay rent",
      due.what === "fund"
        ? { address, abi: rentalEscrowAbi, functionName: "fund" }
        : { address, abi: rentalEscrowAbi, functionName: "payRent", args: [1] },
    ).then((r) => r && setDone(true));

  return page(
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={due.what === "fund" ? t.h("promptpay.fundCard") : t.h("promptpay.rentCard")} aside={<PriceSourceBadge />}>
        <p className="text-3xl font-semibold tabular-nums" data-testid="promptpay-thb">
          {thb === undefined ? "…" : formatFiat(thb, "THB")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="promptpay-usdt">
          {t("promptpay.onChain", { amount: formatUsdt(due.amount) })}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("promptpay.partner")}
        </p>
      </Card>

      <Card title={minted ? t.h("promptpay.step2") : t.h("promptpay.step1")}>
        {!minted ? (
          <div className="flex flex-col items-center gap-3">
            {thb === undefined ? <Skeleton className="h-56 w-56" /> : left > 0 ? <PromptPayQr payload={promptPayPayload(thb)} /> : null}
            {left > 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="promptpay-countdown">
                {t("promptpay.qrValid")} <span className="tabular-nums">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</span>
              </p>
            ) : (
              <ActionButton variant="secondary" onClick={() => (setIssuedAt(Date.now()), setNow(Date.now()))}>
                {t("promptpay.qrExpired")}
              </ActionButton>
            )}
            <ActionButton busy={minting} disabledReason={left === 0 ? t("promptpay.expired") : thb === undefined ? t("promptpay.loadingRate") : null} onClick={paid} data-testid="promptpay-paid" className="w-full">
              {t("promptpay.paid")}
            </ActionButton>
            {mintError && <Notice kind="error">{mintError}</Notice>}
          </div>
        ) : (
          <div className="space-y-3">
            <Notice>
              <span data-testid="promptpay-minted">{t("promptpay.minted", { amount: formatUsdt(due.amount) })}</span>
            </Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionButton
                variant="secondary"
                busy={pending === "Approve USDT"}
                disabledReason={allowance === undefined ? t("promptpay.loadingWallet") : allowance >= due.amount ? t("promptpay.approved") : null}
                onClick={() => send("Approve USDT", { address: deployment.mockUsdt, abi: mockUsdtAbi, functionName: "approve", args: [address, due.amount] })}
                data-testid="promptpay-approve"
              >
                {t("promptpay.approve", { amount: formatUsdt(due.amount) })}
              </ActionButton>
              <ActionButton
                busy={pending === "Fund escrow" || pending === "Prepay rent"}
                disabledReason={
                  balance === undefined || allowance === undefined
                    ? t("promptpay.loadingWallet")
                    : balance < due.amount
                      ? t("promptpay.waitingMint")
                      : allowance < due.amount
                        ? t("promptpay.approveFirst")
                        : null
                }
                onClick={pay}
                data-testid="promptpay-fund"
              >
                {due.what === "fund" ? t("promptpay.fundBoth") : t("promptpay.payPeriod", { per: perIn(t, lease.terms.rentPeriod) })}
              </ActionButton>
            </div>
          </div>
        )}
      </Card>
    </div>,
  );
}
