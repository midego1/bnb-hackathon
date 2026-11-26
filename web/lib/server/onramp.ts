import { getAddress, type Address, type PublicClient } from "viem";
import { escrowFactoryAbi, rentalEscrowAbi, TOKEN } from "../contracts";
import { amountDue } from "../promptpay";
import { DemoError, RateLimiter } from "./demoTestnet/guards";

/**
 * Simulated fiat on-ramp of the "Pay with PromptPay" DEMO (/app/pay/[address], POST /api/demo-testnet/onramp): after
 * "I've paid", the server mints test mUSDT (MockUSDT.faucet) to the rental's renter, for exactly what is due. Nothing
 * else is signed by the server: the renter's own wallet then approves and funds the escrow.
 *
 * Guards: local anvil (31337) or BSC testnet (97) only, the lease must come from this deployment's factory, the
 * amount is read from the chain (never from the request) and capped, and calls are rate-limited. The mint itself:
 * onrampAnvil.ts on 31337, DemoTestnetRunner.onRamp on 97.
 */

export const ONRAMP_CHAINS = [31337, 97] as const;
/** MockUSDT.FAUCET_LIMIT: one simulated payment never mints more. */
export const ONRAMP_MAX = BigInt(10_000) * BigInt(10) ** BigInt(TOKEN.decimals);

// shortcut: per-process (per-isolate on Workers) limit, enough for a demo; move to the shared Durable Object if abused.
const limiter = new RateLimiter({ minGapMs: 5_000, runsPerHour: 60 });

export function checkRate(now = Date.now(), l: RateLimiter = limiter) {
  const wait = l.waitSec(now);
  if (wait > 0) throw new DemoError(429, "rate-limited", `The demo on-ramp just ran. Try again in ${wait} s.`, wait);
  l.record(now);
}

/** Pure: the mint the server makes for a lease read from the chain, or a refusal. */
export function onRampPlan(
  chainId: number,
  lease: {
    isLease: boolean;
    token: Address;
    status: number;
    periodsFunded: number;
    terms: { tenant: Address; depositAmount: bigint; rentAmount: bigint; termPeriods: number };
  },
  deploymentToken: Address,
): { to: Address; amount: bigint } {
  if (!(ONRAMP_CHAINS as readonly number[]).includes(chainId)) throw new DemoError(404, "wrong-chain", "The PromptPay demo runs on local anvil and BSC testnet only.");
  if (!lease.isLease) throw new DemoError(400, "not-a-lease", "That is not a KeyEscrow rental of this deployment.");
  if (lease.token.toLowerCase() !== deploymentToken.toLowerCase()) throw new DemoError(400, "wrong-token", "This rental is not paid in the demo mUSDT.");
  const due = amountDue(lease);
  if (!due) throw new DemoError(409, "nothing-due", "Nothing is due on this rental right now.");
  if (due.amount > ONRAMP_MAX) throw new DemoError(400, "over-cap", `The demo on-ramp covers at most 10,000 ${TOKEN.symbol} per payment.`);
  return { to: lease.terms.tenant, amount: due.amount };
}

/** Reads the lease from the chain, vets it (onRampPlan) and takes a rate-limit slot: what to mint, to whom. */
export async function planOnRamp(client: PublicClient, chainId: number, a: { factory: Address; token: Address }, leaseInput: string) {
  const lease = getAddress(leaseInput);
  const [isLease, terms, status, periodsFunded] = await Promise.all([
    client.readContract({ address: a.factory, abi: escrowFactoryAbi, functionName: "isLease", args: [lease] }),
    client.readContract({ address: lease, abi: rentalEscrowAbi, functionName: "terms" }).catch(() => undefined),
    client.readContract({ address: lease, abi: rentalEscrowAbi, functionName: "status" }).catch(() => 99),
    client.readContract({ address: lease, abi: rentalEscrowAbi, functionName: "periodsFunded" }).catch(() => 0),
  ]);
  const t = terms as { token: Address; tenant: Address; depositAmount: bigint; rentAmount: bigint; termPeriods: number } | undefined;
  if (!t) throw new DemoError(400, "not-a-lease", "That is not a KeyEscrow rental of this deployment.");
  const plan = onRampPlan(chainId, { isLease: isLease as boolean, token: t.token, status: Number(status), periodsFunded: Number(periodsFunded), terms: t }, a.token);
  checkRate();
  return plan;
}
