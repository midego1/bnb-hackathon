import { anvil, anvilRpcUrl } from "../chains";

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(anvilRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`The local chain refused ${method}: ${json.error?.message ?? res.status}`);
  return json.result;
}

/**
 * DEV ONLY: moves the local anvil block clock forward and mines a block (anvil's evm_increaseTime + evm_mine).
 * Refuses to run against anything but the local anvil chain (31337); real networks do not support it anyway.
 */
export async function fastForward(seconds: number) {
  const chainId = Number(await rpc("eth_chainId", []));
  if (chainId !== anvil.id) throw new Error(`Fast-forward only works on the local anvil chain, not chain ${chainId}.`);
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine", []);
}
