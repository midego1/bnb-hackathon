"use client";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { escrowFactoryAbi } from "../contracts";
import { useDeployment } from "./useDeployment";

/** Factory settings that apply to new rentals: one-time fee and the KeyScrow dispute desk (default arbiter). */
export function useFactorySettings() {
  const { chainId, deployment } = useDeployment();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["factorySettings", chainId],
    enabled: !!client && !!deployment,
    staleTime: 60_000,
    queryFn: async () => {
      const read = <T,>(functionName: string) =>
        client!.readContract({ address: deployment!.escrowFactory, abi: escrowFactoryAbi, functionName: functionName as never }) as Promise<T>;
      const [feeBps, defaultArbiter, defaultResponseWindow, defaultArbiterWindow] = await Promise.all([
        read<number>("feeBps"),
        read<Address>("defaultArbiter"),
        read<number>("DEFAULT_RESPONSE_WINDOW"),
        read<number>("DEFAULT_ARBITER_WINDOW"),
      ]);
      return {
        feeBps,
        defaultArbiter: defaultArbiter === zeroAddress ? undefined : defaultArbiter,
        defaultResponseWindow,
        defaultArbiterWindow,
      };
    },
  });
}
