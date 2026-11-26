import type { ActionHost } from "@/lib/actions/context";
import { walletHistory } from "@/lib/server/history";
import { getPriceService } from "@/lib/server/price";

/** The web app's host for the lease actions: server env (RPC per chain), the same price service as GET /api/price, wallet history. */
export function webActionHost(): ActionHost {
  return { env: process.env, prices: () => getPriceService().get(), history: (wallet, chainId) => walletHistory(wallet, chainId) };
}
