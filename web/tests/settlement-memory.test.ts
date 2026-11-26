import { NextRequest } from "next/server";
import { custom, decodeFunctionData, encodeFunctionResult, getAddress, type Abi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionHost } from "@/lib/actions/context";
import { escrowFactoryAbi, getDeployment, rentalEscrowAbi } from "@/lib/contracts";
import type { Scooter } from "@/lib/fleet";

// Scooter memory writes (POST /api/settlement): only for a rental verified on-chain, keyed by that rental, rate-limited.
const { memory, leaseKey } = vi.hoisted(() => ({
  memory: {
    status: { provider: "local" as const, configured: false },
    recall: vi.fn<(id: string) => Promise<{ text: string; source: "local" }[]>>(async () => []),
    remember: vi.fn<(e: unknown) => Promise<{ stored: boolean }>>(async () => ({ stored: true })),
  },
  leaseKey: vi.fn(),
}));
vi.mock("@/lib/server/sponsors/livingbrain", async (orig) => ({ ...(await orig<object>()), inspectionMemoryFromEnv: () => memory }));
vi.mock("@/lib/server/settlement/lease", async (orig) => ({ ...(await orig<object>()), leaseMemoryKey: (...a: unknown[]) => leaseKey(...a) }));

const { POST } = await import("@/app/api/settlement/route");
const { leaseMemoryKey } = await vi.importActual<typeof import("@/lib/server/settlement/lease")>("@/lib/server/settlement/lease");

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const LEASE = getAddress("0x9f1ac54bef0dd2f6f3462ea0fa94fc62300d3a8e");
const OWNER = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
const OTHER = getAddress("0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc");
const base = { deposit: "100000000", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(2) }] };
let ip = 0;

function post(body: unknown, from = `10.0.0.${++ip}`) {
  return POST(new NextRequest("http://localhost/api/settlement", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": from } }));
}

beforeEach(() => {
  memory.recall.mockClear();
  memory.remember.mockClear();
  leaseKey.mockReset();
});

describe("POST /api/settlement scooter memory", () => {
  it("reads memory for a bare scooterId but writes nothing", async () => {
    const body = await (await post({ ...base, scooterId: "BKK-123" })).json();
    expect(memory.recall).toHaveBeenCalledWith("BKK-123");
    expect(memory.remember).not.toHaveBeenCalled();
    expect(leaseKey).not.toHaveBeenCalled();
    expect(body.memoryStored).toBe(false);
  });

  it("writes nothing when the lease is not a KeyEscrow rental", async () => {
    leaseKey.mockResolvedValue(null);
    const body = await (await post({ ...base, scooterId: "BKK-123", lease: OTHER })).json();
    expect(leaseKey).toHaveBeenCalledWith(OTHER, undefined);
    expect(memory.recall).toHaveBeenCalledWith("BKK-123");
    expect(memory.remember).not.toHaveBeenCalled();
    expect(body.memoryStored).toBe(false);
  });

  it("writes nothing when the chain cannot be read", async () => {
    leaseKey.mockRejectedValue(new Error("rpc down"));
    const res = await post({ ...base, lease: LEASE });
    expect(res.status).toBe(200);
    expect(memory.remember).not.toHaveBeenCalled();
  });

  it("reads and writes under the verified rental's scooter, not the request's scooterId", async () => {
    leaseKey.mockResolvedValue({ scooterId: "click-125i-cnx", rental: LEASE });
    const body = await (await post({ ...base, scooterId: "someone-elses-scooter", lease: LEASE, chainId: 31337 })).json();
    expect(leaseKey).toHaveBeenCalledWith(LEASE, 31337);
    expect(memory.recall).toHaveBeenCalledWith("click-125i-cnx");
    expect(memory.remember).toHaveBeenCalledTimes(1);
    expect(memory.remember.mock.calls[0][0]).toMatchObject({ scooterId: "click-125i-cnx", rental: LEASE, reportHash: body.reportHash });
    expect(body).toMatchObject({ memoryStored: true, memory: { scooterId: "click-125i-cnx" } });
  });

  it("limits memory writes to 20 an hour per caller IP, before reading the chain", async () => {
    leaseKey.mockResolvedValue({ scooterId: LEASE, rental: LEASE });
    for (let i = 0; i < 20; i++) expect((await post({ ...base, lease: LEASE }, "10.9.9.9")).status).toBe(200);
    expect(memory.remember).toHaveBeenCalledTimes(20);
    leaseKey.mockClear();
    const over = await post({ ...base, lease: LEASE }, "10.9.9.9");
    expect(over.status).toBe(200); // the inspection still runs, read-only
    expect((await over.json()).memoryStored).not.toBe(true);
    expect(leaseKey).not.toHaveBeenCalled();
    expect(memory.remember).toHaveBeenCalledTimes(20);
    // Another caller is not affected.
    await post({ ...base, lease: LEASE }, "10.9.9.10");
    expect(memory.remember).toHaveBeenCalledTimes(21);
  });

  it("rejects a malformed lease and unknown keys", async () => {
    expect((await post({ ...base, lease: "0x1234" })).status).toBe(400);
    expect((await post({ ...base, lease: LEASE, extra: 1 })).status).toBe(400);
    expect(memory.remember).not.toHaveBeenCalled();
  });
});

describe("leaseMemoryKey (on-chain check, fake node)", () => {
  const D = getDeployment(31337)!;
  function host(isLease: boolean): ActionHost {
    const terms = {
      token: D.mockUsdt,
      landlord: OWNER,
      tenant: OTHER,
      arbiter: OTHER,
      rentAmount: BigInt(1),
      depositAmount: BigInt(2),
      termMonths: 1,
      responseWindow: 0,
      arbiterWindow: 0,
      leaseHash: `0x${"11".repeat(32)}`,
      feeBps: 0,
      feeRecipient: OWNER,
    };
    return {
      env: { KEYESCROW_CHAIN_ID: "31337" },
      transport: () =>
        custom({
          async request({ method, params }) {
            if (method !== "eth_call") throw new Error(`fake node: unexpected ${method}`);
            const { to, data } = (params as [{ to: Address; data: Hex }])[0];
            const abi = (getAddress(to) === D.escrowFactory ? escrowFactoryAbi : rentalEscrowAbi) as Abi;
            const { functionName } = decodeFunctionData({ abi, data });
            return encodeFunctionResult({ abi, functionName, result: functionName === "isLease" ? isLease : terms } as never);
          },
        }),
    };
  }
  const scooter = (id: string, owner: Address, rentals: Address[]) => ({ id, owner, rentals }) as unknown as Scooter;

  it("is null for an address the factory did not create", async () => {
    expect(await leaseMemoryKey(LEASE, 31337, host(false), async () => [])).toBeNull();
  });

  it("uses the catalogue scooter linked to the rental when its owner is the on-chain landlord", async () => {
    const fleet = async () => [scooter("click-125i-cnx", OWNER, [LEASE])];
    expect(await leaseMemoryKey(LEASE.toLowerCase(), undefined, host(true), fleet)).toEqual({ scooterId: "click-125i-cnx", rental: LEASE });
  });

  it("falls back to the rental address when no scooter of the landlord links it", async () => {
    const fleet = async () => [scooter("not-mine", OTHER, [LEASE]), scooter("unlinked", OWNER, [])];
    expect(await leaseMemoryKey(LEASE, 31337, host(true), fleet)).toEqual({ scooterId: LEASE, rental: LEASE });
  });
});
