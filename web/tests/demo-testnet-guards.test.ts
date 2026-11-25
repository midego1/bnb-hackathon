import { encodeFunctionData, parseEther, zeroAddress, type Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import {
  assertDemoChain,
  DemoError,
  demoTestnetConfig,
  DEPLOYER_FLOOR_MIN,
  gasLeft,
  RateLimiter,
  RunLock,
  TOP_UP_CAP,
  topUpPlan,
  vetCall,
  type DemoAddresses,
  type RunState,
} from "@/lib/server/demoTestnet/guards";

const ON = { DEMO_TESTNET_RUNNER: "1", NEXT_PUBLIC_CHAIN_ID: "97", DEMO_TESTNET_SECRETS_DIR: "/nonexistent/secrets" };
const cfg = demoTestnetConfig(ON)!;

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DemoError) return { status: e.status, code: e.code, retry: e.retryAfterSec, msg: e.message };
    throw e;
  }
  return undefined;
};

describe("demo testnet runner: switched off unless flag + chain 97", () => {
  it("is off without DEMO_TESTNET_RUNNER=1", () => {
    expect(demoTestnetConfig({})).toBeUndefined();
    expect(demoTestnetConfig({ ...ON, DEMO_TESTNET_RUNNER: "0" })).toBeUndefined();
    expect(demoTestnetConfig({ ...ON, DEMO_TESTNET_RUNNER: "true" })).toBeUndefined();
  });

  it("is off on any chain but 97", () => {
    for (const id of ["31337", "56", "5611", "1", ""]) expect(demoTestnetConfig({ ...ON, NEXT_PUBLIC_CHAIN_ID: id })).toBeUndefined();
  });

  it("is off without a secrets dir", () => {
    expect(demoTestnetConfig({ ...ON, DEMO_TESTNET_SECRETS_DIR: "" })).toBeUndefined();
  });

  it("is on with all three, with the default limits", () => {
    expect(cfg).toMatchObject({ minGapMs: 60_000, runsPerHour: 12, maxGasPerRun: BigInt(2_500_000), receiptTimeoutMs: 45_000 });
    expect(cfg.topUp.amount).toBe(TOP_UP_CAP);
  });

  it("refuses an RPC that answers another chain", () => {
    expect(code(() => assertDemoChain(56))).toMatchObject({ code: "wrong-chain" });
    expect(code(() => assertDemoChain(31337))).toMatchObject({ code: "wrong-chain" });
    expect(code(() => assertDemoChain(97))).toBeUndefined();
  });
});

describe("demo testnet routes", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("answer 404 when the flag is off", async () => {
    delete process.env.DEMO_TESTNET_RUNNER;
    const run = await import("@/app/api/demo-testnet/run/route");
    const tx = await import("@/app/api/demo-testnet/tx/route");
    const end = await import("@/app/api/demo-testnet/end/route");
    const req = (body: unknown) => new Request("http://localhost/api/demo-testnet/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await run.POST(req({ path: "happy" }))).status).toBe(404);
    expect((await tx.POST(req({}))).status).toBe(404);
    expect((await end.POST(req({}))).status).toBe(404);
  });

  it("answer 404 on a non-97 build even with the flag on", async () => {
    Object.assign(process.env, { ...ON, NEXT_PUBLIC_CHAIN_ID: "31337" });
    const run = await import("@/app/api/demo-testnet/run/route");
    const res = await run.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(404);
  });
});

describe("one run at a time", () => {
  it("refuses a second run while one is live, and frees the lock on release", () => {
    const lock = new RunLock(cfg);
    lock.acquire("a", "happy", 0);
    expect(code(() => lock.acquire("b", "dispute", 1_000))).toMatchObject({ status: 409, code: "busy" });
    expect(lock.release("b")).toBeUndefined(); // someone else's id does not free it
    expect(lock.release("a")?.id).toBe("a");
    expect(lock.acquire("b", "dispute", 2_000).id).toBe("b");
  });

  it("frees an abandoned run after the idle timeout, and refuses the stale id", () => {
    const lock = new RunLock(cfg);
    lock.acquire("a", "happy", 0);
    expect(lock.get("a", 60_000).id).toBe("a"); // activity keeps it alive
    expect(lock.current(60_000 + cfg.idleMs - 1)?.id).toBe("a");
    expect(lock.current(60_000 + cfg.idleMs + 1)).toBeUndefined();
    expect(code(() => lock.get("a", 60_000 + cfg.idleMs + 2))).toMatchObject({ status: 410 });
  });

  it("ends a run that goes on too long even when it stays active", () => {
    const lock = new RunLock(cfg);
    lock.acquire("a", "happy", 0);
    for (let t = 0; t < cfg.maxRunMs; t += 60_000) lock.get("a", t);
    expect(lock.current(cfg.maxRunMs + 1)).toBeUndefined();
  });
});

describe("rate limit", () => {
  it("allows one run per minute", () => {
    const rate = new RateLimiter(cfg);
    expect(code(() => rate.check(0))).toBeUndefined();
    rate.record(0);
    expect(code(() => rate.check(30_000))).toMatchObject({ status: 429, code: "rate-limited", retry: 30 });
    expect(code(() => rate.check(60_000))).toBeUndefined();
  });

  it("caps the runs per hour", () => {
    const rate = new RateLimiter({ minGapMs: 60_000, runsPerHour: 3 });
    for (const t of [0, 60_000, 120_000]) {
      rate.check(t);
      rate.record(t);
    }
    const r = code(() => rate.check(180_000));
    expect(r).toMatchObject({ status: 429, retry: 3_600 - 180 });
    expect(r?.msg).toMatch(/3 times this hour/);
    expect(code(() => rate.check(3_600_000))).toBeUndefined(); // the first one aged out
  });
});

describe("gas: a cap per run and capped top-ups", () => {
  const run = (over: Partial<RunState> = {}): RunState => ({ id: "a", path: "happy", startedAt: 0, lastSeen: 0, gasUsed: BigInt(0), cost: BigInt(0), txs: 0, evidence: 0, ...over });

  it("leaves the rest of the run's gas allowance, then refuses", () => {
    expect(gasLeft(run({ gasUsed: BigInt(1_000_000) }), cfg)).toBe(cfg.maxGasPerRun - BigInt(1_000_000));
    expect(code(() => gasLeft(run({ gasUsed: cfg.maxGasPerRun }), cfg))).toMatchObject({ code: "gas-cap" });
    expect(code(() => gasLeft(run({ txs: cfg.maxTxsPerRun }), cfg))).toMatchObject({ code: "tx-cap" });
  });

  it("tops a low wallet up by at most 0.005 tBNB", () => {
    expect(topUpPlan(parseEther("0.01"), parseEther("1"), cfg.topUp)).toEqual({ action: "none" });
    expect(topUpPlan(parseEther("0.001"), parseEther("0.28"), cfg.topUp)).toEqual({ action: "top-up", amount: parseEther("0.005") });
    // Even a misconfigured amount or env cannot send more than the cap.
    expect(topUpPlan(BigInt(0), parseEther("1"), { ...cfg.topUp, amount: parseEther("1") })).toEqual({ action: "top-up", amount: TOP_UP_CAP });
    expect(demoTestnetConfig({ ...ON, DEMO_TESTNET_TOP_UP_TBNB: "0.5" })!.topUp.amount).toBe(TOP_UP_CAP);
  });

  it("refuses with a friendly message instead of draining the deployer below 0.05 tBNB", () => {
    const p = topUpPlan(BigInt(0), parseEther("0.054"), cfg.topUp);
    expect(p.action).toBe("refuse");
    expect(p.action === "refuse" && p.message).toMatch(/out of test BNB/);
    expect(topUpPlan(BigInt(0), parseEther("0.055"), cfg.topUp).action).toBe("top-up");
    // A lower configured floor is ignored.
    expect(topUpPlan(BigInt(0), parseEther("0.03"), { ...cfg.topUp, deployerFloor: BigInt(0) }).action).toBe("refuse");
    expect(DEPLOYER_FLOOR_MIN).toBe(parseEther("0.05"));
  });
});

describe("the calls the server will sign", () => {
  const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
  const addrs: DemoAddresses = { factory: A(1), token: A(2), accounts: { landlord: A(11), tenant: A(12), arbiter: A(13) } };
  const LEASE = A(99);
  const base: RunState = { id: "a", path: "happy", startedAt: 0, lastSeen: 0, gasUsed: BigInt(0), cost: BigInt(0), txs: 0, evidence: 0 };
  const withLease = { ...base, lease: LEASE };
  const lease = (o: Partial<{ tenant: Address; arbiter: Address; rentAmount: bigint }> = {}) =>
    encodeFunctionData({
      abi: escrowFactoryAbi,
      functionName: "createLease",
      args: [
        {
          tenant: o.tenant ?? addrs.accounts.tenant,
          arbiter: o.arbiter ?? addrs.accounts.arbiter,
          rentAmount: o.rentAmount ?? BigInt(545_000_000),
          depositAmount: BigInt(1_090_000_000),
          termMonths: 12,
          responseWindow: 7 * 86_400,
          arbiterWindow: 14 * 86_400,
          leaseHash: `0x${"ab".repeat(32)}`,
        },
      ],
    });
  const esc = (functionName: string, args: readonly unknown[] = []) => encodeFunctionData({ abi: rentalEscrowAbi, functionName, args } as never);

  it("signs the demo's own createLease once, as the landlord, with the demo tenant and desk", () => {
    expect(vetCall({ role: "landlord", address: addrs.factory, data: lease() }, base, addrs).functionName).toBe("createLease");
    expect(code(() => vetCall({ role: "tenant", address: addrs.factory, data: lease() }, base, addrs))).toMatchObject({ code: "call-refused" });
    expect(code(() => vetCall({ role: "landlord", address: addrs.factory, data: lease({ tenant: A(666) }) }, base, addrs))?.msg).toMatch(/demo tenant/);
    expect(code(() => vetCall({ role: "landlord", address: addrs.factory, data: lease({ arbiter: zeroAddress }) }, base, addrs))?.msg).toMatch(/dispute desk/);
    expect(code(() => vetCall({ role: "landlord", address: addrs.factory, data: lease({ rentAmount: BigInt(10) ** BigInt(12) }) }, base, addrs))?.msg).toMatch(/too large/);
    expect(code(() => vetCall({ role: "landlord", address: addrs.factory, data: lease() }, withLease, addrs))?.msg).toMatch(/already created/);
  });

  it("only mints to the tenant and only approves this run's escrow", () => {
    const faucet = (to: Address, amount: bigint) => encodeFunctionData({ abi: mockUsdtAbi, functionName: "faucet", args: [to, amount] });
    const approve = (spender: Address) => encodeFunctionData({ abi: mockUsdtAbi, functionName: "approve", args: [spender, BigInt(1_635_000_000)] });
    expect(vetCall({ role: "tenant", address: addrs.token, data: faucet(addrs.accounts.tenant, BigInt(1_635_000_000)) }, base, addrs).functionName).toBe("faucet");
    expect(code(() => vetCall({ role: "tenant", address: addrs.token, data: faucet(A(666), BigInt(1)) }, base, addrs))).toMatchObject({ code: "call-refused" });
    expect(vetCall({ role: "tenant", address: addrs.token, data: approve(LEASE) }, withLease, addrs).functionName).toBe("approve");
    expect(code(() => vetCall({ role: "tenant", address: addrs.token, data: approve(A(666)) }, withLease, addrs))).toMatchObject({ code: "call-refused" });
    const transfer = encodeFunctionData({ abi: mockUsdtAbi, functionName: "transfer", args: [A(666), BigInt(1)] });
    expect(code(() => vetCall({ role: "tenant", address: addrs.token, data: transfer }, withLease, addrs))).toMatchObject({ code: "call-refused" });
  });

  it("signs the story's lease calls for the right role, on this run's lease only", () => {
    expect(vetCall({ role: "tenant", address: LEASE, data: esc("fund") }, withLease, addrs).role).toBe("tenant");
    expect(vetCall({ role: "landlord", address: LEASE, data: esc("accept", [1]) }, withLease, addrs).functionName).toBe("accept");
    expect(vetCall({ role: "arbiter", address: LEASE, data: esc("resolve", [BigInt(1), `0x${"cd".repeat(32)}`]) }, withLease, addrs).role).toBe("arbiter");
    expect(code(() => vetCall({ role: "landlord", address: LEASE, data: esc("resolve", [BigInt(1), `0x${"cd".repeat(32)}`]) }, withLease, addrs))).toMatchObject({ code: "call-refused" });
    expect(code(() => vetCall({ role: "tenant", address: LEASE, data: esc("claimTimeout") }, withLease, addrs))?.msg).toMatch(/days of real time/);
    expect(code(() => vetCall({ role: "tenant", address: A(77), data: esc("fund") }, withLease, addrs))?.msg).toMatch(/not part of this demo run/);
    expect(code(() => vetCall({ role: "tenant", address: LEASE, data: esc("fund") }, base, addrs))?.msg).toMatch(/Create the lease first/);
    expect(code(() => vetCall({ role: "deployer", address: LEASE, data: esc("fund") }, withLease, addrs))?.msg).toMatch(/Unknown demo role/);
    expect(code(() => vetCall({ role: "tenant", address: LEASE, data: "0xdeadbeef" }, withLease, addrs))?.msg).toMatch(/does not match/);
    expect(code(() => vetCall({ role: "tenant", address: LEASE, data: esc("addEvidence", [1, `0x${"ee".repeat(32)}`]) }, { ...withLease, evidence: 8 }, addrs))?.msg).toMatch(/Enough photos/);
  });
});
