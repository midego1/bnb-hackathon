/**
 * LOCAL ONLY. A throwaway anvil (chainId 31337) on a free port in 28660-28689, deployed and seeded with the repo's
 * forge scripts (Deploy.s.sol + Seed.s.sol) into a temporary deployments dir. Used by the rental-action integration
 * test and `pnpm agent:demo:tools`. Refuses ports that are already taken, so it never reuses someone else's node.
 *
 * The keys below are anvil's well-known PUBLIC default dev keys; they only ever sign on this local chain.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Address, Hex } from "viem";
import { REPO_DIR } from "../src/config.ts";

export const ANVIL_DEV_KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  owner: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  renter: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  arbiter: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;

export type Seeded = { lease: Address; disputedLease: Address; landlord: Address; tenant: Address; arbiter: Address };

export type LocalChain = { rpc: string; port: number; seeded: Seeded; stop: () => void };

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(true));
  });
}

async function rpcUp(rpc: string): Promise<boolean> {
  try {
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return (await res.json()).result === "0x7a69";
  } catch {
    return false;
  }
}

export async function startLocalChain(opts: { ports?: [number, number] } = {}): Promise<LocalChain> {
  const [lo, hi] = opts.ports ?? [28660, 28689];
  let port = 0;
  for (let p = lo; p <= hi && !port; p++) if (await portFree(p)) port = p;
  if (!port) throw new Error(`no free port in ${lo}-${hi}`);
  const rpc = `http://127.0.0.1:${port}`;

  const anvil: ChildProcess = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], { stdio: "ignore" });
  const contracts = path.join(REPO_DIR, "contracts");
  const tmp = mkdtempSync(path.join(contracts, "deployments", ".e2e-actions-"));
  const stop = () => {
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
    rmSync(tmp, { recursive: true, force: true });
  };
  process.once("exit", stop);
  try {
    for (let i = 0; i < 100 && !(await rpcUp(rpc)); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await rpcUp(rpc))) throw new Error(`anvil did not come up on ${rpc}`);
    const env = { ...process.env, DEPLOYMENTS_DIR: path.relative(contracts, tmp), PRIVATE_KEY: ANVIL_DEV_KEYS.deployer, ALLOW_NON_LOCAL_BROADCAST: "false" };
    for (const script of ["script/Deploy.s.sol", "script/Seed.s.sol"]) {
      const r = spawnSync("forge", ["script", script, "--rpc-url", rpc, "--broadcast"], { cwd: contracts, env, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`forge script ${script} failed:\n${(r.stdout + r.stderr).split("\n").slice(-20).join("\n")}`);
    }
    const seeded = JSON.parse(readFileSync(path.join(tmp, "31337.demo.json"), "utf8")) as Seeded;
    return { rpc, port, seeded, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
