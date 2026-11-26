/**
 * The live stage demo in BSC mainnet mode (chain 56, real money, max 1 USD), rehearsed end to end on a throwaway LOCAL
 * anvil started with --chain-id 56 (base fee 0, like BSC), with the 18-decimal BSC-USD mock
 * at the real BSC-USD address and contracts/script/Deploy.s.sol's real mainnet path (default pilot caps 0.70 / 0.30 / 5).
 * Nothing reaches BSC mainnet: every key is made fresh for this run and the RPC must answer from 127.0.0.1.
 *
 *   pnpm -C web stage:mainnet:rehearse      (or from the root: pnpm stage:mainnet:rehearse)
 *
 * drip (exactly 1.00 USDT + 0.0003 BNB, transferred, once per wallet) -> rent (owner offers 0.30 + 0.70, the judge
 * funds) -> pickup and return photos -> AI split (the demo inspector, as on a server without a vision key) -> propose
 * -> the presenter accepts -> settled, every balance exact. Then the limits: a 1.01 USD rental reverts with the pilot cap
 * message, the funder's budget floor (< 2 USDT) stops the next drip, the hourly cap the one after.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, parseEther, parseUnits, toHex, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BSC_USD = "0x55d398326f99059fF775485246999027B3197955" as const;
const CONTRACTS = path.resolve(__dirname, "../../contracts");
const PORT = Number(process.env.STAGE_REHEARSAL_PORT ?? 28570);
const RPC = `http://127.0.0.1:${PORT}`;
const usd = (v: string) => parseUnits(v, 18);
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const keys = { deployer: generatePrivateKey(), owner: generatePrivateKey(), funder: generatePrivateKey(), treasury: generatePrivateKey() };
const who = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, privateKeyToAccount(v).address])) as Record<keyof typeof keys, Address>;
const chain = { ...bsc, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
const deploymentsDir = `deployments/.rehearsal/stage-56-${process.pid}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "stage56-"));
let anvil: ChildProcess | undefined;

const portInUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

function forge(args: string[], env: Record<string, string> = {}) {
  // A clean env: nothing from the caller's shell or .env (no real RPC, no real key) reaches forge.
  const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", KEYESCROW_NO_DOTENV: "1", FOUNDRY_BROADCAST: path.join(tmp, "broadcast") };
  const r = spawnSync("forge", args, { cwd: CONTRACTS, env: { ...base, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`forge ${args.join(" ")} failed:\n${(r.stdout + r.stderr).split("\n").slice(-25).join("\n")}`);
  return r.stdout.trim();
}

const usdtOf = (a: Address) => pub.readContract({ address: BSC_USD, abi: erc20, functionName: "balanceOf", args: [a] });

type Stage = typeof import("@/lib/server/stage");
let stage: NonNullable<ReturnType<Stage["getStage"]>>;
let mod: {
  lib: typeof import("@/lib/stage");
  tx: typeof import("@/components/stage/judgeTx");
  settlement: typeof import("@/lib/server/settlement");
  errors: typeof import("@/lib/errors");
  contracts: typeof import("@/lib/contracts");
  state: typeof import("@/lib/server/state");
};
let factory: Address;

beforeAll(async () => {
  if (await portInUse(PORT)) throw new Error(`port ${PORT} is in use; refusing to reuse a node this rehearsal did not start (STAGE_REHEARSAL_PORT=...)`);
  anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(PORT), "--chain-id", "56", "--base-fee", "0", "--silent"], { stdio: "ignore" });
  for (let i = 0; (await pub.getChainId().catch(() => 0)) !== 56; i++) {
    if (i > 100) throw new Error(`anvil --chain-id 56 did not start on ${RPC}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  forge(["build", "-q"]);
  const code = forge(["inspect", "test/mocks/MockBscUsd.sol:MockBscUsd", "deployedBytecode"]) as Hex;
  await pub.request({ method: "anvil_setCode" as never, params: [BSC_USD, code] as never });
  const setBalance = (a: Address, wei: bigint) => pub.request({ method: "anvil_setBalance" as never, params: [a, toHex(wei)] as never });
  await setBalance(who.deployer, parseEther("1"));
  await setBalance(who.owner, parseEther("0.01"));
  await setBalance(who.funder, parseEther("0.01"));
  // The funder holds 2.5 USDT: one drip (1.00) leaves 1.50, under the 2 USDT floor, so the next drip is refused.
  const minter = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(keys.deployer) });
  await pub.waitForTransactionReceipt({ hash: await minter.writeContract({ address: BSC_USD, abi: erc20, functionName: "faucet", args: [who.funder, usd("2.5")] }) });

  // The real mainnet deploy path: BSC-USD, no Fleet Vault, default pilot caps; the dispute desk is the deployer.
  forge(["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast"], {
    PRIVATE_KEY: keys.deployer,
    ALLOW_NON_LOCAL_BROADCAST: "true",
    MAINNET_I_UNDERSTAND: "yes",
    FACTORY_OWNER: who.deployer,
    FEE_RECIPIENT: who.treasury,
    DEFAULT_ARBITER: who.deployer,
    DEPLOYMENTS_DIR: deploymentsDir,
  });
  const d = JSON.parse(readFileSync(path.join(CONTRACTS, deploymentsDir, "56.json"), "utf8"));
  expect([d.maxDeposit, d.maxRentPerPeriod, d.maxActiveValue]).toEqual([usd("0.70"), usd("0.30"), usd("5")].map(String));
  factory = d.escrowFactory;

  // A chain-56 build, as `NEXT_PUBLIC_CHAIN_ID=56 next build` sees it. Set before the app's modules load.
  Object.assign(process.env, {
    NEXT_PUBLIC_CHAIN_ID: "56",
    NEXT_PUBLIC_BSC_RPC_URL: RPC,
    NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: factory,
    NEXT_PUBLIC_MOCK_USDT_ADDRESS: BSC_USD,
    NEXT_PUBLIC_DISPUTE_DESK_ADDRESS: who.deployer,
  });
  const [s, lib, tx, settlement, errors, contracts, state] = await Promise.all([
    import("@/lib/server/stage"),
    import("@/lib/stage"),
    import("@/components/stage/judgeTx"),
    import("@/lib/server/settlement"),
    import("@/lib/errors"),
    import("@/lib/contracts"),
    import("@/lib/server/state"),
  ]);
  mod = { lib, tx, settlement, errors, contracts, state };
  const shared = new state.MemoryState();
  const env = {
    ...process.env,
    STAGE_DEMO: "1",
    DEMO_MAINNET_OWNER_KEY: keys.owner,
    DEMO_MAINNET_FUNDER_KEY: keys.funder,
    DEMO_MAINNET_RPC_URL: RPC,
    STAGE_DRIPS_PER_HOUR: "2",
  };
  stage = s.getStage(env, () => shared)!;
  expect(stage.cfg).toMatchObject({ chainId: 56, dripsPerHour: 2, dripsPerDay: 30 });
}, 180_000);

afterAll(() => {
  anvil?.kill("SIGTERM");
  rmSync(path.join(CONTRACTS, deploymentsDir), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

describe("stage on BSC mainnet (anvil --chain-id 56)", () => {
  const SLUG = "mystery-box";
  const judgeKey = generatePrivateKey();
  const judge = privateKeyToAccount(judgeKey).address;
  const H = (s: string) => keccak256(toHex(s));

  it("a judge rents the box with real money, max 1 USD: every amount exact", async () => {
    const { lib, tx, settlement, contracts } = mod;
    const judgeWallet = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(judgeKey) });
    const step = async () => lib.judgeStep(await stage.status(SLUG, judge), judge);

    expect(contracts.TOKEN.decimals).toBe(18);
    const first = await stage.status(SLUG, judge);
    expect(first.price).toMatchObject({ rent: usd("0.30"), deposit: usd("0.70") });
    expect(await step()).toBe("money");

    // Drip: transferred from the funder, exactly what the rental needs, once per wallet.
    const funderBefore = await usdtOf(who.funder);
    const drip = await stage.drip(SLUG, judge);
    expect(drip.txs).toHaveLength(2);
    expect(await usdtOf(judge)).toBe(usd("1"));
    expect(await pub.getBalance({ address: judge })).toBe(parseEther("0.0003"));
    expect(funderBefore - (await usdtOf(who.funder))).toBe(usd("1"));
    expect(await stage.drip(SLUG, judge)).toEqual({ txs: drip.txs, repeat: true });
    await expect(stage.drip(SLUG, who.owner)).rejects.toThrow(/belongs to the demo/);
    expect(await step()).toBe("rent");

    // Rent: the owner offers (server-signed), the judge funds from the phone's guest key.
    const { lease } = await stage.lease(SLUG, judge);
    expect(await step()).toBe("fund");
    await tx.fundLease(judgeWallet, pub, lease);
    expect(await usdtOf(judge)).toBe(BigInt(0));
    expect(await usdtOf(lease)).toBe(usd("1"));
    expect(await step()).toBe("pickup");

    await tx.anchorPhotos(judgeWallet, pub, lease, "pickup", [H("pickup-1")], []);
    expect(await step()).toBe("return");
    await tx.anchorPhotos(judgeWallet, pub, lease, "return", [H("return-1")], []);
    expect(await step()).toBe("inspect");

    // The AI split: the demo inspector, exactly as POST /api/settlement answers without a vision key.
    const split = await settlement.proposeSettlement({ deposit: usd("0.70").toString(), decimals: 18, currency: "USDT", checkIn: [{ hash: H("pickup-1") }], checkOut: [{ hash: H("return-1") }], scooterId: SLUG });
    const refund = BigInt(split.tenantRefund);
    const claim = BigInt(split.landlordClaim);
    expect(refund + claim).toBe(usd("0.70"));
    await tx.proposeSplit(judgeWallet, pub, lease, refund, split.reportHash as Hex);
    expect(await step()).toBe("waiting");

    const ownerBefore = await usdtOf(who.owner);
    expect((await stage.accept(SLUG)).repeat).toBe(false);
    expect((await stage.status(SLUG, judge)).lease?.status).toBe("Settled");
    expect(await step()).toBe("settled");
    expect(await usdtOf(lease)).toBe(BigInt(0));
    expect(await usdtOf(judge)).toBe(refund);
    expect(await usdtOf(who.treasury)).toBe(usd("0.03")); // the one-time fee: 10 % of the 0.30 month
    expect((await usdtOf(who.owner)) - ownerBefore).toBe(usd("0.27") + claim);
    expect(await pub.readContract({ address: factory, abi: contracts.escrowFactoryAbi, functionName: "activeValue" })).toBe(BigInt(0));
    // The judge's ~6 transactions fit in the 0.0003 BNB drip with room to spare.
    const gasLeft = await pub.getBalance({ address: judge });
    expect(gasLeft > BigInt(0) && gasLeft < parseEther("0.0003")).toBe(true);
    console.log(`[rehearsal] settled: judge got ${split.tenantRefund} back, owner +${(usd("0.27") + claim).toString()}, fee 0.03 USDT; judge gas used ${parseEther("0.0003") - gasLeft} wei`);
  }, 180_000);

  it("a 1.01 USD rental reverts with the pilot cap message", async () => {
    const { contracts, errors } = mod;
    const terms = (rent: string, deposit: string) => ({
      account: privateKeyToAccount(keys.owner),
      address: factory,
      abi: contracts.escrowFactoryAbi,
      functionName: "createLease" as const,
      args: [{ tenant: privateKeyToAccount(generatePrivateKey()).address, arbiter: who.deployer, rentAmount: usd(rent), depositAmount: usd(deposit), termPeriods: 1, rentPeriod: 30 * 86_400, responseWindow: 0, arbiterWindow: 0, leaseHash: H("cap") }] as const,
    });
    const tryIt = (rent: string, deposit: string) => pub.simulateContract(terms(rent, deposit)).then(() => "ok", (e: unknown) => errors.friendlyError(e));
    expect(await tryIt("0.30", "0.71")).toMatch(/^Pilot limit: this deposit is above/);
    expect(await tryIt("0.31", "0.70")).toMatch(/^Pilot limit: this rent is above/);
    expect(await tryIt("0.30", "0.70")).toBe("ok");
  });

  it("stops at the funder's budget floor (< 2 USDT), then at the hourly cap", async () => {
    expect(await usdtOf(who.funder)).toBe(usd("1.5"));
    const next = privateKeyToAccount(generatePrivateKey()).address;
    await expect(stage.drip(SLUG, next)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/out of money/) });
    expect(await usdtOf(next)).toBe(BigInt(0));
    expect(await pub.getBalance({ address: next })).toBe(BigInt(0));
    await expect(stage.drip(SLUG, privateKeyToAccount(generatePrivateKey()).address)).rejects.toMatchObject({ status: 429 });
  });
});
