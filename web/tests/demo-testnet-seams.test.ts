import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { assertDedicatedDesk, DemoError, demoTestnetConfig } from "@/lib/server/demoTestnet/guards";
import { demoSecretsFromEnvVars, loadDemoSecrets } from "@/lib/server/demoTestnet/keys";
import { MemoryRunStore } from "@/lib/server/demoTestnet/store";

const errOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof DemoError ? e : (e as Error);
  }
  return undefined;
};

const keys = { landlord: generatePrivateKey(), tenant: generatePrivateKey(), arbiter: generatePrivateKey() };
const BASE = { DEMO_TESTNET_RUNNER: "1", NEXT_PUBLIC_CHAIN_ID: "97" };

describe("one key loader: env vars (Workers) or the secrets dir (local)", () => {
  it("switches the runner on with DEMO_TESTNET_KEYS and no secrets dir", () => {
    expect(demoTestnetConfig({ ...BASE, DEMO_TESTNET_KEYS: JSON.stringify(keys) })).toBeDefined();
    expect(demoTestnetConfig({ ...BASE })).toBeUndefined();
  });

  it("reads the three demo wallets and an optional funder from env vars", async () => {
    const funder = generatePrivateKey();
    const env = { DEMO_TESTNET_KEYS: JSON.stringify(keys), DEMO_TESTNET_RPC_URL: "https://rpc.example", DEMO_TESTNET_FUNDER_KEY: funder };
    const s = await loadDemoSecrets(env, demoTestnetConfig({ ...BASE, ...env })!);
    expect(s.source).toBe("env");
    expect(s.wallets.arbiter.address).toBe(privateKeyToAccount(keys.arbiter).address);
    expect(s.funder?.address).toBe(privateKeyToAccount(funder).address);
    expect((await s.funder!.account()).address).toBe(privateKeyToAccount(funder).address);
    expect(demoSecretsFromEnvVars({ ...env, DEMO_TESTNET_FUNDER_KEY: "" }).funder).toBeUndefined(); // no top-ups then
  });

  it("refuses bad env keys without echoing them", async () => {
    const rpc = { DEMO_TESTNET_RPC_URL: "https://rpc.example" };
    const bad = await errOf(() => demoSecretsFromEnvVars({ ...rpc, DEMO_TESTNET_KEYS: JSON.stringify({ ...keys, tenant: "0x1234" }) }));
    expect(bad?.message).toMatch(/tenant key is not a 32-byte hex key/);
    expect(bad?.message).not.toContain("0x1234");
    expect((await errOf(() => demoSecretsFromEnvVars({ ...rpc, DEMO_TESTNET_KEYS: "{oops" })))?.message).toMatch(/not valid JSON/);
    expect((await errOf(() => demoSecretsFromEnvVars({ DEMO_TESTNET_KEYS: JSON.stringify(keys) })))?.message).toMatch(/no BSC testnet RPC/);
  });

  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("locally creates the demo wallets in the secrets dir (mode 600) and uses the deployer as funder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "demo-secrets-"));
    dirs.push(dir);
    const deployer = privateKeyToAccount(generatePrivateKey()).address;
    const env = { ...BASE, DEMO_TESTNET_SECRETS_DIR: dir, DEMO_TESTNET_RPC_URL: "https://rpc.example", DEPLOYER_ADDRESS: deployer };
    const s = await loadDemoSecrets(env, demoTestnetConfig(env)!);
    expect(s.source).toBe("secrets-dir");
    expect(s.funder?.address).toBe(deployer);
    expect((await stat(path.join(dir, "testnet-demo-wallets.json"))).mode & 0o777).toBe(0o600);
    const again = await loadDemoSecrets(env, demoTestnetConfig(env)!);
    expect(again.wallets.tenant.address).toBe(s.wallets.tenant.address); // same wallets next time
  });
});

describe("the dispute desk is a dedicated demo wallet", () => {
  const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
  const others = { defaultArbiter: A(1), funder: A(2), landlord: A(11), tenant: A(12) };
  it("refuses the deployer (factory default arbiter), the funder or a party as desk", () => {
    expect(() => assertDedicatedDesk(A(13), others)).not.toThrow();
    expect(() => assertDedicatedDesk(A(1), others)).toThrow(/not the defaultArbiter/);
    expect(() => assertDedicatedDesk(A(2), others)).toThrow(/not the funder/);
    expect(() => assertDedicatedDesk(A(12), others)).toThrow(/not the tenant/);
  });
});

describe("MemoryRunStore: the lock and rate limit behind the store interface", () => {
  const cfg = demoTestnetConfig({ ...BASE, DEMO_TESTNET_SECRETS_DIR: "/x" })!;
  it("starts one run, refuses another browser, lets the same browser take over, and frees on end", async () => {
    const store = new MemoryRunStore(cfg);
    const { run } = await store.begin({ id: "a", owner: "browser-A", path: "happy", now: 0 });
    expect(await store.peek(1_000)).toEqual({ busy: true, waitSec: 0 });
    expect(await errOf(() => store.begin({ id: "b", owner: "browser-B", path: "happy", now: 1_000 }))).toMatchObject({ status: 409, code: "busy" });
    const t = await store.begin({ id: "a2", owner: "browser-A", path: "dispute", now: 2_000 });
    expect(t.replaced?.id).toBe(run.id);
    expect(await errOf(() => store.touch("a", 3_000))).toMatchObject({ status: 410 });
    expect((await store.end("a2"))?.id).toBe("a2");
    expect(await store.peek(4_000)).toEqual({ busy: false, waitSec: 58 }); // 60 s gap since the last start (at 2 s)
    expect(await errOf(() => store.begin({ id: "c", owner: "browser-B", path: "happy", now: 4_000 }))).toMatchObject({ status: 429 });
  });

  it("carries a resumed lease into the new run", async () => {
    const store = new MemoryRunStore(cfg);
    const { run } = await store.begin({ id: "a", owner: "browser-A", path: "happy", now: 0, lease: "0x00000000000000000000000000000000000000aa" });
    expect(run.lease).toBe("0x00000000000000000000000000000000000000aa");
  });
});
