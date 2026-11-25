/**
 * The e2e anvil is shared by every spec in the run. The /demo "owner ignores it" story fast-forwards its clock by 7 days
 * (evm_increaseTime), which would push the seeded dispute past the dispute desk's 14-day window for every spec that
 * runs later. Specs that can play that story call `restoreChainAfterEachTest()`: each test runs on an anvil snapshot
 * (evm_snapshot) that is reverted afterwards (evm_revert), which also resets the block clock. So the chain every other
 * spec sees is the one global setup seeded, plus real time, whatever the order the specs run in.
 */
import { test } from "@playwright/test";
import { E2E_RPC_URL } from "./env";

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(E2E_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

/** The anvil block clock (latest block timestamp, seconds). */
export const chainTime = async () => Number(BigInt((await rpc<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false])).timestamp));

export function restoreChainAfterEachTest() {
  let snapshot: string | undefined;
  test.beforeEach(async () => {
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterEach(async ({ page }) => {
    // Stop the page first, so no transaction from a still-running demo lands after the revert.
    await page.close();
    if (snapshot) {
      const ok = await rpc<boolean>("evm_revert", [snapshot]);
      if (!ok) throw new Error(`evm_revert(${snapshot}) failed`);
    }
    snapshot = undefined;
  });
}
