import { afterEach, describe, expect, it, vi } from "vitest";

// lib/chains and lib/contracts read NEXT_PUBLIC_* at module load, so each case re-imports them.
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  const chains = await import("@/lib/chains");
  const contracts = await import("@/lib/contracts");
  return { ...chains, ...contracts };
}

const FACTORY = "0x1111111111111111111111111111111111111111";
const USDT = "0x2222222222222222222222222222222222222222";

afterEach(() => vi.unstubAllEnvs());

describe("chain + deployment config", () => {
  it("targets anvil by default with the synced 31337 deployment and no explorer", async () => {
    const c = await load({ NEXT_PUBLIC_CHAIN_ID: "" });
    expect(c.targetChainId).toBe(31337);
    expect(c.supportedChains[0].id).toBe(31337);
    const d = c.getDeployment(31337)!;
    expect(d.escrowFactory).toBe("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
    expect(d.disputeDesk).toBe("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    expect(c.explorerLink(31337, "tx", "0xabc")).toBeUndefined();
  });

  it("targets BSC testnet with NEXT_PUBLIC_CHAIN_ID=97, drops anvil, links BscScan", async () => {
    const c = await load({ NEXT_PUBLIC_CHAIN_ID: "97" });
    expect(c.targetChainId).toBe(97);
    expect(c.supportedChains.map((x) => x.id)).toEqual([97, 5611]);
    expect(c.explorerLink(97, "address", "0xabc")).toBe("https://testnet.bscscan.com/address/0xabc");
  });

  it("applies env address overrides only to the target chain", async () => {
    const c = await load({ NEXT_PUBLIC_CHAIN_ID: "97", NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: FACTORY, NEXT_PUBLIC_MOCK_USDT_ADDRESS: USDT });
    expect(c.getDeployment(97)).toMatchObject({ escrowFactory: FACTORY, mockUsdt: USDT, fromBlock: BigInt(0) });
    expect(c.getDeployment(31337)!.escrowFactory).toBe("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
  });
});
