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
      <p className="text-lg font-bold uppercase tracking-wide">Demo, no real money</p>
      <p className="text-sm">
        This is not a payment page. No bank or payment provider is connected and the QR goes to a fake demo id. &ldquo;I&rsquo;ve paid&rdquo;
        mints test mUSDT on {chainName(chainId)} instead.
      </p>
    </div>
  );
  const page = (body: React.ReactNode) => (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-subtle">
          <Link href={`/lease/${address}`} className="hover:underline">
            ← Back to the rental
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Pay with PromptPay (demo)</h1>
      </div>
      {banner}
      {body}
    </div>
  );

  if (!deployment) return page(<Notice kind="warn">KeyEscrow is not deployed on {chainName(chainId)}.</Notice>);
  if (isLoading) return page(<Skeleton className="h-64" />);
  if (error || !lease) return page(<Notice kind="error">No KeyEscrow rental could be read at {address} on {chainName(chainId)}.</Notice>);
  if (viewerRole(lease, me) !== "tenant") return page(<Notice kind="warn">Connect the renter&rsquo;s wallet of this rental to pay for it.</Notice>);

  if (done)
    return page(
      <Notice>
        <span data-testid="promptpay-done">Paid into the escrow from your own wallet. </span>
        <Link href={`/lease/${address}`} className="font-medium underline">
          Open the rental
        </Link>
      </Notice>,
    );

  const due = amountDue(lease);
  if (!due) return page(<Notice>Nothing is due on this rental right now.</Notice>);
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
      if (res.status === 404) throw new Error("The demo on-ramp is not switched on for this server. Use “Get test USDT” on the rental page instead.");
      if (!res.ok) throw new Error(json.error ?? `The demo on-ramp answered ${res.status}.`);
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
      <Card title={due.what === "fund" ? "Deposit + first month" : "One month's rent"} aside={<PriceSourceBadge />}>
        <p className="text-3xl font-semibold tabular-nums" data-testid="promptpay-thb">
          {thb === undefined ? "…" : formatFiat(thb, "THB")}
        </p>
        <p className="mt-1 text-sm text-muted" data-testid="promptpay-usdt">
          = {formatUsdt(due.amount)} mUSDT on-chain
        </p>
        <p className="mt-4 text-sm text-muted">
          With a licensed Thai partner, the renter would pay this in baht from any banking app, and the partner would deliver the stablecoin to the
          renter&rsquo;s wallet. The escrow itself is unchanged: the renter&rsquo;s own wallet funds it.
        </p>
      </Card>

      <Card title={minted ? "2. Fund the escrow from your wallet" : "1. Scan and pay (simulated)"}>
        {!minted ? (
          <div className="flex flex-col items-center gap-3">
            {thb === undefined ? <Skeleton className="h-56 w-56" /> : left > 0 ? <PromptPayQr payload={promptPayPayload(thb)} /> : null}
            {left > 0 ? (
              <p className="text-sm text-muted" data-testid="promptpay-countdown">
                QR valid for <span className="tabular-nums">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</span>
              </p>
            ) : (
              <ActionButton variant="secondary" onClick={() => (setIssuedAt(Date.now()), setNow(Date.now()))}>
                QR expired: make a new one
              </ActionButton>
            )}
            <ActionButton busy={minting} disabledReason={left === 0 ? "The QR expired." : thb === undefined ? "Loading the exchange rate…" : null} onClick={paid} data-testid="promptpay-paid" className="w-full">
              I&rsquo;ve paid (simulate)
            </ActionButton>
            {mintError && <Notice kind="error">{mintError}</Notice>}
          </div>
        ) : (
          <div className="space-y-3">
            <Notice>
              <span data-testid="promptpay-minted">Simulated payment received: {formatUsdt(due.amount)} test mUSDT arrived in your wallet.</span>
            </Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionButton
                variant="secondary"
                busy={pending === "Approve USDT"}
                disabledReason={allowance === undefined ? "Loading your wallet…" : allowance >= due.amount ? "Approved." : null}
                onClick={() => send("Approve USDT", { address: deployment.mockUsdt, abi: mockUsdtAbi, functionName: "approve", args: [address, due.amount] })}
                data-testid="promptpay-approve"
              >
                Approve {formatUsdt(due.amount)} USDT
              </ActionButton>
              <ActionButton
                busy={pending === "Fund escrow" || pending === "Prepay rent"}
                disabledReason={
                  balance === undefined || allowance === undefined
                    ? "Loading your wallet…"
                    : balance < due.amount
                      ? "Waiting for the test mUSDT to arrive…"
                      : allowance < due.amount
                        ? "Approve first."
                        : null
                }
                onClick={pay}
                data-testid="promptpay-fund"
              >
                {due.what === "fund" ? "Fund deposit + rent" : "Pay one month"}
              </ActionButton>
            </div>
          </div>
        )}
      </Card>
    </div>,
  );
}
