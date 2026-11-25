/**
 * Starts a throwaway anvil (127.0.0.1:28546) and deploys + seeds it with contracts/script/Deploy.s.sol and
 * Seed.s.sol. Refuses to run if the port is already taken, so it can never reuse someone else's node.
 * Returns a teardown that kills only the anvil it started.
 *
 * LOCAL ONLY: PRIVATE_KEY below is anvil's well-known public default dev key #0.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { getAddress } from "viem";
import { E2E_RPC_PORT } from "../playwright.config";

const WEB = path.resolve(__dirname, "..");
const CONTRACTS = path.resolve(WEB, "../contracts");
// Under contracts/deployments/.e2e/ (gitignored), separate from the e2e:chain runner's files.
const DEPLOYMENTS_DIR = "deployments/.e2e/web";
const RPC = `http://127.0.0.1:${E2E_RPC_PORT}`;
const ANVIL_DEFAULT_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

async function waitForRpc() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if ((await res.json()).result === "0x7a69") return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not come up on ${RPC}`);
}

function forge(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("forge", args, { cwd: CONTRACTS, env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`forge ${args.join(" ")} failed:\n${(r.stdout + r.stderr).split("\n").slice(-30).join("\n")}`);
}

export default async function globalSetup() {
  if (await portInUse(E2E_RPC_PORT)) {
    throw new Error(`port ${E2E_RPC_PORT} is already in use; refusing to reuse a node this test did not start`);
  }
  const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(E2E_RPC_PORT), "--chain-id", "31337", "--silent"], {
    stdio: "ignore",
  });
  const stop = () => {
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
  };
  process.once("exit", stop);

  try {
    await waitForRpc();
    rmSync(path.join(CONTRACTS, DEPLOYMENTS_DIR), { recursive: true, force: true });
    forge(["build"]);
    const env = { DEPLOYMENTS_DIR, PRIVATE_KEY: ANVIL_DEFAULT_KEY_0, ALLOW_NON_LOCAL_BROADCAST: "false" };
    forge(["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast"], env);
    forge(["script", "script/Seed.s.sol", "--rpc-url", RPC, "--broadcast"], env);

    // The app bakes in lib/contracts/deployments.generated.json (synced from the fresh-anvil deployment);
    // a deterministic deploy must land on the same addresses.
    const deployed = JSON.parse(readFileSync(path.join(CONTRACTS, DEPLOYMENTS_DIR, "31337.json"), "utf8"));
    const baked = JSON.parse(readFileSync(path.join(WEB, "lib/contracts/deployments.generated.json"), "utf8"))["31337"];
    for (const [k, b] of [
      ["escrowFactory", "escrowFactory"],
      ["token", "mockUsdt"],
      ["defaultArbiter", "disputeDesk"],
    ] as const) {
      if (getAddress(deployed[k]) !== getAddress(baked[b])) {
        throw new Error(`deployed ${k} ${deployed[k]} != app config ${baked[b]}; run \`pnpm -C web sync:contracts\``);
      }
    }
    console.log(`[e2e] anvil ${RPC}: deployed + seeded (factory ${deployed.escrowFactory})`);
  } catch (e) {
    stop();
    throw e;
  }
  return async () => {
    stop();
    rmSync(path.join(CONTRACTS, DEPLOYMENTS_DIR), { recursive: true, force: true });
  };
}
