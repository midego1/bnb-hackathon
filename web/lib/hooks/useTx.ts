"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Abi, TransactionReceipt } from "viem";
import { useToasts } from "@/components/Toasts";
import { noteMinedBlock } from "../chainIndex";
import { explorerLink } from "../chains";
import { friendlyError } from "../errors";
import { errorsIn } from "../errors.zh";
import { useT } from "../i18n/client";

type Call = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /** Native BNB sent with the call (payable functions). */
  value?: bigint;
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
  const t = useT();
  const { lang } = t;

  const send = useCallback(
    async (label: string, call: Call, opts: { throwOnError?: boolean } = {}): Promise<TransactionReceipt | undefined> => {
      if (!account) {
        toasts.push({ kind: "error", title: label, body: t("tx.connectFirst") });
        if (opts.throwOnError) throw new Error(t("tx.noWallet"));
        return;
      }
      setPending(label);
      const id = toasts.push({ kind: "pending", title: label, body: t("tx.confirm") });
      try {
        const { request } = await simulateContract(config, { ...call, account, chainId } as never);
        const hash = await writeContract(config, request as never);
        toasts.update(id, { body: t("tx.waiting"), href: chainId ? explorerLink(chainId, "tx", hash) : undefined });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId });
        if (receipt.status !== "success") throw new Error(t("tx.reverted"));
        toasts.update(id, { kind: "success", body: t("tx.confirmed") });
        // The server-side chain index refreshes past its cache until it has this block.
        if (chainId) noteMinedBlock(chainId, receipt.blockNumber);
        await queryClient.invalidateQueries();
        return receipt;
      } catch (err) {
        const message = friendlyError(err, errorsIn(lang));
        toasts.update(id, { kind: "error", body: message });
        if (opts.throwOnError) throw new Error(message);
        return undefined;
      } finally {
        setPending(null);
      }
    },
    [account, chainId, config, queryClient, toasts, lang, t],
  );

  return { send, pending };
}
