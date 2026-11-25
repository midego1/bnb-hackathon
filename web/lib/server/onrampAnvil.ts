import { createPublicClient, createWalletClient, http, type Address, type PublicClient } from "viem";
import { anvilRpcUrl } from "../chains";
import { getDeployment, mockUsdtAbi } from "../contracts";
import { DemoError } from "./demoTestnet/guards";
import { planOnRamp } from "./onramp";

/** Anvil default account #0 (the deployer; a public dev address): anvil signs for it, the server holds no key. */
const ANVIL_SENDER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** PromptPay demo on-ramp on local anvil (31337): MockUSDT.faucet to the renter, sent from anvil's unlocked account #0. */
export async function onRampAnvil(lease: string) {
  const d = getDeployment(31337);
  if (!d) throw new DemoError(503, "not-deployed", "KeyEscrow is not deployed on the local chain.");
  const client = createPublicClient({ transport: http(anvilRpcUrl) }) as PublicClient;
  if ((await client.getChainId()) !== 31337) throw new DemoError(503, "wrong-chain", "The local RPC does not answer chain 31337. Refusing.");
  const plan = await planOnRamp(client, 31337, { factory: d.escrowFactory, token: d.mockUsdt }, lease);
  const wallet = createWalletClient({ transport: http(anvilRpcUrl) });
  const hash = await wallet.writeContract({ account: ANVIL_SENDER, chain: null, address: d.mockUsdt, abi: mockUsdtAbi, functionName: "faucet", args: [plan.to, plan.amount] });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new DemoError(502, "chain-error", "The test mUSDT mint was reverted.");
  return { hash, to: plan.to, amount: plan.amount.toString() };
}
