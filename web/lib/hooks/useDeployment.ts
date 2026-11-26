"use client";

import { useAccount, useChainId } from "wagmi";
import { getDeployment } from "../contracts";

/**
 * Chain to read from: the wallet's chain when KeyScrow is deployed there, else the app's default, so a wallet on
 * another network (e.g. BSC mainnet) still sees the data. Writes are gated on the wallet's own chain (WalletGate).
 */
export function useDeployment() {
  const configChainId = useChainId();
  const { chainId: walletChainId } = useAccount();
  const chainId = walletChainId && getDeployment(walletChainId) ? walletChainId : configChainId;
  return { chainId, deployment: getDeployment(chainId) };
}
