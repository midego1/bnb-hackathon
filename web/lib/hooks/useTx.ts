"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Abi, TransactionReceipt } from "viem";
import { useToasts } from "@/components/Toasts";
import { explorerLink } from "../chains";
import { friendlyError } from "../errors";

type Call = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

/**
 * Sends a contract call with a pending -> confirmed/failed toast, then refreshes every on-chain query.
 * The call is simulated first so reverts surface as plain-language errors before the wallet prompt.
 * Failures resolve to `undefined` (the toast says why); pass `{ throwOnError: true }` to get a rejected
 * promise with the plain-language message instead (the guided demo uses this to offer a Retry).
 */
export function useTx() {
  const config = useConfig();
  const { address: account, chainId } = useAccount();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = useCallback(
    async (label: string, call: Call, opts: { throwOnError?: boolean } = {}): Promise<TransactionReceipt | undefined> => {
      if (!account) {
        toasts.push({ kind: "error", title: label, body: "Connect a wallet first." });
        if (opts.throwOnError) throw new Error("No wallet is connected.");
        return;
      }
      setPending(label);
      const id = toasts.push({ kind: "pending", title: label, body: "Confirm in your wallet…" });
      try {
        const { request } = await simulateContract(config, { ...call, account, chainId } as never);
        const hash = await writeContract(config, request as never);
        toasts.update(id, { body: "Waiting for the block…", href: chainId ? explorerLink(chainId, "tx", hash) : undefined });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId });
        if (receipt.status !== "success") throw new Error("The transaction was reverted on-chain.");
        toasts.update(id, { kind: "success", body: "Confirmed." });
        await queryClient.invalidateQueries();
        return receipt;
      } catch (err) {
        const message = friendlyError(err);
        toasts.update(id, { kind: "error", body: message });
        if (opts.throwOnError) throw new Error(message);
        return undefined;
      } finally {
        setPending(null);
      }
    },
    [account, chainId, config, queryClient, toasts],
  );

  return { send, pending };
}
