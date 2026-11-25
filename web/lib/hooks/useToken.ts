"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { mockUsdtAbi } from "../contracts";
import { useDeployment } from "./useDeployment";

/** Wallet USDT balance and allowance towards `spender`. */
export function useTokenState(owner: Address | undefined, spender: Address | undefined) {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["token", chainId, owner?.toLowerCase(), spender?.toLowerCase()],
    enabled: !!client && !!deployment && !!owner,
    refetchInterval: 8_000,
    queryFn: async () => {
      const token = deployment!.mockUsdt;
      const [balance, allowance] = await Promise.all([
        client!.readContract({ address: token, abi: mockUsdtAbi, functionName: "balanceOf", args: [owner!] }),
        spender
          ? client!.readContract({ address: token, abi: mockUsdtAbi, functionName: "allowance", args: [owner!, spender] })
          : Promise.resolve(BigInt(0)),
      ]);
      return { balance, allowance };
    },
  });
}
