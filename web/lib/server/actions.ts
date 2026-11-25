import type { ActionHost } from "@/lib/actions/context";
import { getPriceService } from "@/lib/server/price";

/** The web app's host for the lease actions: server env (RPC per chain) and the same price service as GET /api/price. */
export function webActionHost(): ActionHost {
  return { env: process.env, prices: () => getPriceService().get() };
}
