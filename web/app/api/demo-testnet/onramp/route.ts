import { handle, OnRampBody, serve } from "@/lib/server/demoTestnet/http";

/**
 * POST {lease}: the simulated on-ramp of the "Pay with PromptPay" DEMO (lib/server/onramp.ts). Mints the test mUSDT due
 * on that rental to its renter; no real payment is checked. BSC testnet: through the live demo runner (404 when off).
 */
export async function POST(req: Request) {
  // Local anvil has no runner: anvil signs. NEXT_PUBLIC_CHAIN_ID is inlined at build time, so a BSC testnet (Workers)
  // build drops this branch and its imports (a route with its own imports costs ~100 KiB gzip in the Worker).
  if ((process.env.NEXT_PUBLIC_CHAIN_ID || "31337") === "31337") {
    return serve(req, async (body) => (await import("@/lib/server/onrampAnvil")).onRampAnvil(OnRampBody.parse(body).lease));
  }
  return handle(req, (runner, body) => runner.onRamp(OnRampBody.parse(body).lease));
}
