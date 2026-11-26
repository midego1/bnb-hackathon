import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Env } from "../env";
import { DEMO_ROLES, DemoError, type DemoRole, type DemoTestnetConfig } from "./guards";

/**
 * Where the live demo runner gets its keys. ONE function, two sources:
 *
 *   env vars (Cloudflare Workers, or any host without a filesystem): set with `wrangler secret put`, never in git
 *     DEMO_TESTNET_KEYS          JSON {"landlord":"0x…","tenant":"0x…","arbiter":"0x…"}: the three demo wallets
 *     DEMO_TESTNET_FUNDER_KEY    optional: a small dedicated wallet that pays gas top-ups (NOT the deployer). Without
 *                                it there are no top-ups: a run is refused with a friendly message when a wallet is low
 *     DEMO_TESTNET_RPC_URL       BSC testnet RPC (or BSC_TESTNET_RPC_URL)
 *
 *   secrets dir (local `pnpm testnet:web`): DEMO_TESTNET_SECRETS_DIR (+ DEMO_TESTNET_ENV_FILE, the repo-root .env)
 *     <dir>/testnet-demo-wallets.json   the three demo wallets, created on first use (mode 600)
 *     funder = the deployer keystore from the .env (DEPLOYER_KEYSTORE + DEPLOYER_PASSWORD_FILE), decrypted on the
 *     first top-up only
 *
 * The env source wins when DEMO_TESTNET_KEYS is set. The Node-only file code is imported lazily, so a Workers bundle
 * never runs it. Keys never leave the server: not in responses, not in logs, not in error messages.
 */

export type DemoSecrets = {
  source: "env" | "secrets-dir";
  rpc: string;
  wallets: Record<DemoRole, PrivateKeyAccount>;
  /** Pays gas top-ups. The address is known up front (balance checks); the key is loaded on the first top-up. */
  funder?: { address: Address; account(): Promise<PrivateKeyAccount> };
};

export type DemoSecretsSource = () => Promise<DemoSecrets>;

const WALLETS_FILE = "testnet-demo-wallets.json";
const WALLETS_NOTE = "KeyScrow BSC testnet (97) live-demo wallets (landlord, tenant, dispute desk). Testnet only. Never fund on mainnet. Never commit.";

const keyOrThrow = (v: unknown, what: string): Hex => {
  if (typeof v !== "string" || !isHex(v) || v.length !== 66) throw new DemoError(503, "not-configured", `The live testnet demo's ${what} key is not a 32-byte hex key.`);
  return v;
};

/** The three demo wallets (and optional funder) from env vars: the Workers source. */
export function demoSecretsFromEnvVars(env: Env): DemoSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.DEMO_TESTNET_KEYS ?? "");
  } catch {
    throw new DemoError(503, "not-configured", "DEMO_TESTNET_KEYS is not valid JSON.");
  }
  const keys = (parsed ?? {}) as Record<string, unknown>;
  const wallets = Object.fromEntries(DEMO_ROLES.map((r) => [r, privateKeyToAccount(keyOrThrow(keys[r], r))])) as Record<DemoRole, PrivateKeyAccount>;
  const rpc = env.DEMO_TESTNET_RPC_URL || env.BSC_TESTNET_RPC_URL;
  if (!rpc) throw new DemoError(503, "not-configured", "The live testnet demo has no BSC testnet RPC configured on this server.");
  const funderKey = env.DEMO_TESTNET_FUNDER_KEY;
  const funder = funderKey ? privateKeyToAccount(keyOrThrow(funderKey, "funder")) : undefined;
  return { source: "env", rpc, wallets, funder: funder && { address: funder.address, account: async () => funder } };
}

/** The three demo wallets from the secrets dir, and the deployer keystore as funder: the local (Node) source. */
async function demoSecretsFromDir(env: Env, cfg: DemoTestnetConfig): Promise<DemoSecrets> {
  if (!cfg.secretsDir) throw new DemoError(503, "not-configured", "The live testnet demo has no keys configured on this server.");
  const [{ existsSync, readFileSync }, path, { parseEnvFile }, { loadDeployer, loadWallets }] = await Promise.all([
    import("node:fs"),
    import("node:path"),
    import("../chain97.mts"),
    import("../chain97-keys.mts"),
  ]);
  const file = cfg.envFile;
  const fromFile = file && existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {};
  const pick = (k: string) => env[k] || fromFile[k];
  const rpc = cfg.rpc || pick("BSC_TESTNET_RPC_URL");
  if (!rpc) throw new DemoError(503, "not-configured", "The live testnet demo has no BSC testnet RPC configured on this server.");
  const w = loadWallets(path.join(cfg.secretsDir, WALLETS_FILE), DEMO_ROLES, { create: true, note: WALLETS_NOTE })!;
  const deployerAddress = pick("DEPLOYER_ADDRESS");
  let deployer: PrivateKeyAccount | undefined;
  const deployerEnv = { DEPLOYER_KEYSTORE: pick("DEPLOYER_KEYSTORE"), DEPLOYER_PASSWORD_FILE: pick("DEPLOYER_PASSWORD_FILE"), DEPLOYER_ADDRESS: deployerAddress };
  return {
    source: "secrets-dir",
    rpc,
    wallets: w.accounts,
    funder:
      deployerAddress && isAddress(deployerAddress)
        ? { address: getAddress(deployerAddress), account: async () => (deployer ??= loadDeployer(deployerEnv)) }
        : undefined,
  };
}

/** THE key loader of the runner: env vars when DEMO_TESTNET_KEYS is set (Workers), else the local secrets dir. */
export function loadDemoSecrets(env: Env, cfg: DemoTestnetConfig): Promise<DemoSecrets> {
  return env.DEMO_TESTNET_KEYS ? Promise.resolve(demoSecretsFromEnvVars(env)) : demoSecretsFromDir(env, cfg);
}
