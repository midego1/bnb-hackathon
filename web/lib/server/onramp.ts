import { createWalletClient, getAddress, http, type Address, type Hash } from "viem";
import { actionContext, rpcUrl } from "../actions/context";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "../contracts";
import { amountDue } from "../promptpay";
import { DemoError, RateLimiter } from "./demoTestnet/guards";
import { demoRunner } from "./demoTestnet/http";
import type { Env } from "./env";

/**
 * Simulated fiat on-ramp of the "Pay with PromptPay" DEMO (/app/pay/[address]): after "I've paid", the server mints
 * test mUSDT (MockUSDT.faucet) to the rental's renter, for exactly what is due. Nothing else is signed by the server:
 * the renter's own wallet then approves and funds the escrow.
 *
 * Guards: local anvil (31337) or BSC testnet (97) only, the lease must come from this deployment's factory, the
 * amount is read from the chain (never from the request) and capped, and calls are rate-limited.
 */

export const ONRAMP_CHAINS = [31337, 97] as const;
/** MockUSDT.FAUCET_LIMIT: one simulated payment never mints more. */
export const ONRAMP_MAX = BigInt(10_000) * BigInt(1_000_000);
/** Anvil default account #0 (the deployer; a public dev address): anvil signs for it, the server holds no key. */
const ANVIL_SENDER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

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
    monthsFunded: number;
    terms: { tenant: Address; depositAmount: bigint; rentAmount: bigint; termMonths: number };
  },
  deploymentToken: Address,
): { to: Address; amount: bigint } {
  if (!(ONRAMP_CHAINS as readonly number[]).includes(chainId)) throw new DemoError(404, "wrong-chain", "The PromptPay demo runs on local anvil and BSC testnet only.");
  if (!lease.isLease) throw new DemoError(400, "not-a-lease", "That is not a KeyEscrow rental of this deployment.");
  if (lease.token.toLowerCase() !== deploymentToken.toLowerCase()) throw new DemoError(400, "wrong-token", "This rental is not paid in the demo mUSDT.");
  const due = amountDue(lease);
  if (!due) throw new DemoError(409, "nothing-due", "Nothing is due on this rental right now.");
  if (due.amount > ONRAMP_MAX) throw new DemoError(400, "over-cap", "The demo on-ramp covers at most 10,000 mUSDT per payment.");
  return { to: lease.terms.tenant, amount: due.amount };
}

/** Reads the lease, vets it, rate-limits, then mints. Returns the mint tx. */
export async function simulateOnRamp(leaseAddress: Address, env: Env = process.env): Promise<{ hash: Hash; to: Address; amount: string }> {
  const ctx = actionContext({ env });
  const { client, deployment } = ctx;
  const [isLease, terms, status, monthsFunded] = await Promise.all([
    client.readContract({ address: deployment.escrowFactory, abi: escrowFactoryAbi, functionName: "isLease", args: [leaseAddress] }),
    client.readContract({ address: leaseAddress, abi: rentalEscrowAbi, functionName: "terms" }).catch(() => undefined),
    client.readContract({ address: leaseAddress, abi: rentalEscrowAbi, functionName: "status" }).catch(() => 99),
    client.readContract({ address: leaseAddress, abi: rentalEscrowAbi, functionName: "monthsFunded" }).catch(() => 0),
  ]);
  const t = terms as { token: Address; tenant: Address; depositAmount: bigint; rentAmount: bigint; termMonths: number } | undefined;
  if (!t) throw new DemoError(400, "not-a-lease", "That is not a KeyEscrow rental of this deployment.");
  const plan = onRampPlan(
    ctx.chainId,
    { isLease: isLease as boolean, token: t.token, status: Number(status), monthsFunded: Number(monthsFunded), terms: t },
    deployment.token,
  );
  checkRate();

  let hash: Hash;
  if (ctx.chainId === 31337) {
    if ((await client.getChainId()) !== 31337) throw new DemoError(503, "wrong-chain", "The local RPC does not answer chain 31337. Refusing.");
    const wallet = createWalletClient({ transport: http(rpcUrl(31337, env)) });
    hash = await wallet.writeContract({ account: ANVIL_SENDER, chain: null, address: deployment.token, abi: mockUsdtAbi, functionName: "faucet", args: [plan.to, plan.amount] });
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new DemoError(502, "chain-error", "The test mUSDT mint was reverted.");
  } else {
    const runner = demoRunner(env);
    if (!runner) throw new DemoError(503, "off", "The demo on-ramp needs the live testnet demo wallets, which are not set up on this server. Use “Get test USDT” on the rental page.");
    hash = await runner.faucet(plan.to, plan.amount);
  }
  return { hash, to: getAddress(plan.to), amount: plan.amount.toString() };
}
