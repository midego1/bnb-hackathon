"use client";

import { useAccount, useChainId } from "wagmi";
import { getDeployment } from "../contracts";

/** Active chain (connected wallet's chain, else the default) and the KeyEscrow deployment on it. */
export function useDeployment() {
  const configChainId = useChainId();
  const { chainId: walletChainId } = useAccount();
  const chainId = walletChainId ?? configChainId;
  return { chainId, deployment: getDeployment(chainId) };
}
