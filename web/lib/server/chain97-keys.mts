/**
 * Node-only key loading for BSC testnet (chain 97): the deployer's encrypted keystore and throwaway wallet files in the
 * gitignored secrets dir. Used by scripts/testnet.mts and by the live demo runner's local key source
 * (lib/server/demoTestnet/keys.ts). Never imported by a client component, and never on Cloudflare Workers (no
 * filesystem there: the runner takes its keys from env vars instead). Keys are never printed or logged.
 */
import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { concat, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CHAIN_ID } from "./chain97.mts";

/** Decrypts a Web3 Secret Storage (v3) keystore, as written by `cast wallet new` / `cast wallet import`. */
export function decryptKeystore(file: string, password: string): Hex {
  const { crypto: c } = JSON.parse(readFileSync(file, "utf8"));
  const salt = Buffer.from(c.kdfparams.salt, "hex");
  let dk: Buffer;
  if (c.kdf === "scrypt") {
    const { n, r, p, dklen } = c.kdfparams;
    dk = scryptSync(password, salt, dklen, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  } else if (c.kdf === "pbkdf2") {
    dk = pbkdf2Sync(password, salt, c.kdfparams.c, c.kdfparams.dklen, "sha256");
  } else throw new Error(`unsupported keystore kdf ${c.kdf}`);
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const mac = keccak256(concat([toHex(dk.subarray(16, 32)), toHex(ciphertext)])).slice(2);
  if (mac !== String(c.mac).toLowerCase()) throw new Error("keystore password does not match (MAC check failed)");
  const d = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  return toHex(Buffer.concat([d.update(ciphertext), d.final()]));
}

/** Reads DEPLOYER_KEYSTORE, DEPLOYER_PASSWORD_FILE and DEPLOYER_ADDRESS (process.env or a parsed env file). */
export type DeployerEnv = Record<string, string | undefined>;

/** The deployer from its encrypted keystore (decrypted in memory only), cross-checked against DEPLOYER_ADDRESS. */
export function loadDeployer(env: DeployerEnv): PrivateKeyAccount {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set (repo-root .env, see docs/DEPLOY.md)`);
    return v;
  };
  const password = readFileSync(need("DEPLOYER_PASSWORD_FILE"), "utf8").replace(/\r?\n$/, "");
  const account = privateKeyToAccount(decryptKeystore(need("DEPLOYER_KEYSTORE"), password));
  if (account.address.toLowerCase() !== need("DEPLOYER_ADDRESS").toLowerCase()) {
    throw new Error("DEPLOYER_KEYSTORE does not hold DEPLOYER_ADDRESS. Refusing.");
  }
  return account;
}

/**
 * Throwaway testnet wallets, one per role, kept in a JSON file (mode 600) next to the other secrets. Created on first
 * use when `create` is set. Keys are never printed; only the file holds them.
 */
export function loadWallets<R extends string>(
  file: string,
  roles: readonly R[],
  opts: { create: boolean; note: string },
): { accounts: Record<R, PrivateKeyAccount>; created: boolean } | undefined {
  if (existsSync(file)) {
    const w = JSON.parse(readFileSync(file, "utf8")) as Record<string, { key?: Hex }>;
    const accounts = {} as Record<R, PrivateKeyAccount>;
    for (const role of roles) {
      const key = w[role]?.key;
      if (!key) throw new Error(`${path.basename(file)} has no ${role} key`);
      accounts[role] = privateKeyToAccount(key);
    }
    return { accounts, created: false };
  }
  if (!opts.create) return undefined;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const keys = Object.fromEntries(roles.map((r) => [r, generatePrivateKey()])) as Record<R, Hex>;
  const out = Object.fromEntries(roles.map((r) => [r, { address: privateKeyToAccount(keys[r]).address, key: keys[r] }]));
  writeFileSync(file, JSON.stringify({ note: opts.note, chainId: CHAIN_ID, ...out }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  const accounts = Object.fromEntries(roles.map((r) => [r, privateKeyToAccount(keys[r])])) as Record<R, PrivateKeyAccount>;
  return { accounts, created: true };
}
