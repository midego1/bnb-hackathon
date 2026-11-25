/** Server-side lease reads for the actions: one snapshot of a RentalEscrow, read over the context's RPC. */
import { BaseError, type Address, type Hex } from "viem";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "../contracts";
import { ActionError, type ActionContext } from "./context";
import { formatToken, STATUS_NAMES, type StatusName } from "./fields";

/** Who may call an action. On-chain names: owner = landlord, renter = tenant, arbiter = the dispute desk. */
export type Role = "owner" | "renter" | "arbiter" | "anyone";

export type LeaseSnapshot = {
  address: Address;
  chainId: number;
  status: StatusName;
  terms: {
    token: Address;
    owner: Address;
    renter: Address;
    arbiter: Address;
    rentAmount: bigint;
    depositAmount: bigint;
    termMonths: number;
    responseWindow: number;
    arbiterWindow: number;
    leaseHash: Hex;
    feeBps: number;
    feeRecipient: Address;
  };
  startTime: bigint;
  monthsFunded: number;
  monthsReleased: number;
  monthsDue: number;
  checkInHash: Hex;
  checkOutHash: Hex;
  proposal: { tenantRefund: bigint; landlordClaim: bigint; reportHash: Hex; proposer: Address; proposedAt: bigint; nonce: number };
  timeoutAt: bigint;
  arbiterDeadline: bigint;
  feeCharged: boolean;
  /** Where the owner's payouts go: the owner, or e.g. a Fleet Vault. */
  payee: Address;
  /** mUSDT held by the escrow right now. */
  balance: bigint;
  /** Timestamp of the block the snapshot was read at (anvil time jumps included). */
  chainNow: bigint;
};

export function rpcError(err: unknown): ActionError {
  const msg = err instanceof BaseError ? err.shortMessage : (err as Error)?.message;
  return new ActionError(502, "rpc_unavailable", "Could not reach the blockchain node. Try again in a moment.", { cause: msg });
}

export async function assertLease(ctx: ActionContext, address: Address): Promise<void> {
  let ok: boolean;
  try {
    ok = await ctx.client.readContract({ address: ctx.deployment.escrowFactory, abi: escrowFactoryAbi, functionName: "isLease", args: [address] });
  } catch (err) {
    throw rpcError(err);
  }
  if (!ok) throw new ActionError(404, "not_found", `${address} is not a KeyEscrow rental on chain ${ctx.chainId}.`);
}

export async function readLease(ctx: ActionContext, address: Address): Promise<LeaseSnapshot> {
  await assertLease(ctx, address);
  const c = ctx.client;
  const r = <T>(functionName: string) =>
    c.readContract({ address, abi: rentalEscrowAbi, functionName: functionName as never }) as Promise<T>;
  try {
    const [block, terms, status, startTime, monthsFunded, monthsReleased, monthsDue, checkInHash, checkOutHash, proposal, timeoutAt, arbiterDeadline, feeCharged, payee] =
      await Promise.all([
        c.getBlock(),
        r<{ token: Address; landlord: Address; tenant: Address; arbiter: Address; rentAmount: bigint; depositAmount: bigint; termMonths: number; responseWindow: number; arbiterWindow: number; leaseHash: Hex; feeBps: number; feeRecipient: Address }>("terms"),
        r<number>("status"),
        r<bigint>("startTime"),
        r<number>("monthsFunded"),
        r<number>("monthsReleased"),
        r<number>("monthsDue"),
        r<Hex>("checkInHash"),
        r<Hex>("checkOutHash"),
        r<LeaseSnapshot["proposal"]>("proposal"),
        r<bigint>("timeoutAt"),
        r<bigint>("arbiterDeadline"),
        r<boolean>("feeCharged"),
        r<Address>("payee"),
      ]);
    const balance = await c.readContract({ address: terms.token, abi: mockUsdtAbi, functionName: "balanceOf", args: [address] });
    const { landlord, tenant, ...rest } = terms;
    return {
      address,
      chainId: ctx.chainId,
      status: STATUS_NAMES[status],
      terms: { ...rest, owner: landlord, renter: tenant },
      startTime,
      monthsFunded,
      monthsReleased,
      monthsDue,
      checkInHash,
      checkOutHash,
      proposal: { ...proposal },
      timeoutAt,
      arbiterDeadline,
      feeCharged,
      payee,
      balance,
      chainNow: block.timestamp,
    };
  } catch (err) {
    throw rpcError(err);
  }
}

/** Roles `who` holds on this lease (an address can only hold one: the factory enforces distinct roles). */
export function roleOf(lease: LeaseSnapshot, who: Address): Exclude<Role, "anyone"> | null {
  const w = who.toLowerCase();
  if (lease.terms.owner.toLowerCase() === w) return "owner";
  if (lease.terms.renter.toLowerCase() === w) return "renter";
  if (lease.terms.arbiter.toLowerCase() === w) return "arbiter";
  return null;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "the owner (landlord on-chain)",
  renter: "the renter (tenant on-chain)",
  arbiter: "the dispute desk (arbiter)",
  anyone: "anyone",
};

export function isoTime(seconds: bigint | number): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

/** A JSON-friendly view of a snapshot: amounts as base-unit strings plus a display string. */
export function leaseJson(l: LeaseSnapshot) {
  const amt = (v: bigint) => ({ units: v.toString(), display: formatToken(v) });
  return {
    address: l.address,
    chainId: l.chainId,
    status: l.status,
    owner: l.terms.owner,
    renter: l.terms.renter,
    arbiter: l.terms.arbiter,
    payee: l.payee,
    token: l.terms.token,
    rent: amt(l.terms.rentAmount),
    deposit: amt(l.terms.depositAmount),
    termMonths: l.terms.termMonths,
    responseWindowDays: l.terms.responseWindow / 86400,
    arbiterWindowDays: l.terms.arbiterWindow / 86400,
    leaseHash: l.terms.leaseHash,
    feeBps: l.terms.feeBps,
    startedAt: l.startTime > BigInt(0) ? isoTime(l.startTime) : null,
    monthsFunded: l.monthsFunded,
    monthsReleased: l.monthsReleased,
    monthsDue: l.monthsDue,
    checkInHash: l.checkInHash,
    checkOutHash: l.checkOutHash,
    proposal:
      l.proposal.nonce > 0
        ? {
            nonce: l.proposal.nonce,
            proposer: l.proposal.proposer,
            proposerRole: roleOf(l, l.proposal.proposer),
            toRenter: amt(l.proposal.tenantRefund),
            toOwner: amt(l.proposal.landlordClaim),
            reportHash: l.proposal.reportHash,
            proposedAt: isoTime(l.proposal.proposedAt),
          }
        : null,
    renterTimeoutAt: l.timeoutAt > BigInt(0) ? isoTime(l.timeoutAt) : null,
    arbiterDeadline: l.arbiterDeadline > BigInt(0) ? isoTime(l.arbiterDeadline) : null,
    escrowBalance: amt(l.balance),
    chainTime: isoTime(l.chainNow),
  };
}
