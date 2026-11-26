import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { actionContext, ActionError, type ActionHost } from "@/lib/actions/context";
import { assertLease } from "@/lib/actions/lease";
import { rentalEscrowAbi } from "@/lib/contracts";
import type { Scooter } from "@/lib/fleet";
import { getFleetStore } from "../fleet";
import { SettlementRequestSchema } from "./schema";

/**
 * POST /api/settlement's body: the shared inspection request plus the rental being inspected. Kept out of the shared
 * schema on purpose: the agent (A2A, MCP) takes no rental, its memory is read-only.
 */
export const SettlementRouteRequestSchema = SettlementRequestSchema.extend({
  /** RentalEscrow address: checked on-chain, then memory is read and written under that rental's scooter. */
  lease: z.string().refine(isAddress, "lease must be a 0x address").optional(),
  /** Chain of `lease`; defaults to the server's chain. */
  chainId: z.number().int().positive().optional(),
});

/**
 * Which scooter an inspection of a real rental is remembered under (POST /api/settlement only). The rental must be an
 * escrow of this deployment's factory (EscrowFactory.isLease, read on-chain), so a made-up address writes nothing.
 * The id comes from the rental, never from request text: the catalogue scooter it is linked to when that scooter's
 * owner is the rental's on-chain landlord (so history carries over between rentals), else the rental address itself.
 * Null when the address is not a KeyScrow rental; RPC failures throw.
 */
export async function leaseMemoryKey(
  lease: string,
  chainId: number | undefined,
  host: ActionHost = { env: process.env },
  scooters: (chainId: number) => Promise<Scooter[]> = async (id) => (await getFleetStore().read(id)).scooters,
): Promise<{ scooterId: string; rental: Address } | null> {
  const ctx = actionContext(host, chainId);
  const rental = getAddress(lease);
  try {
    await assertLease(ctx, rental);
  } catch (err) {
    if (err instanceof ActionError && err.code === "not_found") return null;
    throw err;
  }
  const { landlord } = (await ctx.client.readContract({ address: rental, abi: rentalEscrowAbi, functionName: "terms" })) as { landlord: Address };
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const scooter = (await scooters(ctx.chainId)).find((s) => same(s.owner, landlord) && s.rentals.some((r) => same(r, rental)));
  return { scooterId: scooter?.id ?? rental, rental };
}
