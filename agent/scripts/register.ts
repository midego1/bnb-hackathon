/**
 * ERC-8004 registration of KeyScrow Inspector on BSC testnet (chainId 97) with the BNB Agent SDK. See docs/AGENT.md.
 *
 *   pnpm agent:register:check            preflight; NEVER sends a transaction
 *   pnpm agent:register [-- --yes]       the broadcast: needs ALLOW_NON_LOCAL_BROADCAST=true and a typed confirmation
 *                                        (--yes skips the prompt). Writes agent/deployments/97.json.
 *   pnpm agent:set-uri:check             preflight for pointing the registered agent at AGENT_PUBLIC_URL; NEVER sends
 *   pnpm agent:set-uri [-- --yes]        setAgentURI(agentId, new registration file) as the owner: same guards
 *                                        (typed confirmation "set-uri"). Updates deployments/97.json.
 *   pnpm agent:rehearse                  the whole path against a throwaway local anvil (agent/scripts/rehearse.sh)
 *
 * Env (the repo-root .env is loaded for names that are not already set; KEYESCROW_NO_DOTENV=1 skips it). Same wallet
 * approach as contracts/script/testnet.sh:
 *   BSC_TESTNET_RPC_URL        required. Must answer chainId 97.
 *   DEPLOYER_ADDRESS           required. Public address of the registering wallet (becomes the agent's owner).
 *   one wallet:  DEPLOYER_ACCOUNT (cast wallet keystore name, preferred) | DEPLOYER_KEYSTORE (path) | PRIVATE_KEY
 *   DEPLOYER_PASSWORD_FILE     optional keystore password file (otherwise a hidden prompt)
 *   INSPECTOR_SIGNER_ADDRESS   address of the server's INSPECTOR_PRIVATE_KEY; stored as `reportSigner` metadata.
 *                              Defaults to the address of INSPECTOR_PRIVATE_KEY when that is set. Not needed for set-uri.
 *   AGENT_PUBLIC_URL           required. Public base URL of the agent (A2A card + MCP endpoint in the registration file)
 *   ERC8004_REGISTRY_ADDRESS   optional registry override (default: the SDK's BSC testnet Identity Registry)
 *   ALLOW_NON_LOCAL_BROADCAST  must be `true` for `register` (also in the local rehearsal: same guard)
 *   FORCE_REREGISTER           `true` to register again although deployments/97.json exists
 *   INSPECTOR_DEPLOYMENTS_DIR  where the registration record goes (default agent/deployments)
 *
 * The private key is decrypted in memory, handed to the SDK's EVMWalletProvider with a throwaway wallets dir in the
 * OS temp dir (removed on exit), so nothing is written to ~/.bnbagent. Sponsorship (MegaFuel) is off: the deployer
 * pays its own gas, and no third-party relay is contacted.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { EVMWalletProvider, NETWORKS } from "@bnbagent/sdk";
import { AgentURIGenerator, ERC8004Agent, getBuiltWithValue } from "@bnbagent/sdk/erc8004";
import { BSC_TESTNET_CHAIN_ID } from "@bnbagent/sdk/networks";
import { decryptKeystoreV3 } from "@bnbagent/sdk/wallets";
import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentEndpoints } from "../src/card.ts";
import { AGENT_DESCRIPTION, AGENT_DIR, AGENT_NAME, readDeployment, REPO_DIR, type AgentDeployment } from "../src/config.ts";
import { decodeReportSigner, IDENTITY_REGISTRY_ABI, REPORT_SIGNER_KEY } from "./registry.ts";

const CHAIN_ID = BSC_TESTNET_CHAIN_ID; // 97
const NETWORK = "bsc-testnet";
// Anvil's well-known default dev accounts 0-9 (public knowledge): refused on any real network.
const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9", "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
];

const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c("32"), red = c("31"), yellow = c("33"), bold = c("1");
let fails = 0;
const ok = (m: string) => console.log(`  ${green("✓")} ${m}`);
const bad = (m: string) => {
  console.log(`  ${red("✗")} ${m}`);
  fails++;
};
const warn = (m: string) => console.log(`  ${yellow("!")} ${m}`);
function die(m: string, code = 1): never {
  console.error(red(m));
  process.exit(code);
}

function loadDotenv() {
  const file = path.join(REPO_DIR, ".env");
  if (process.env.KEYESCROW_NO_DOTENV === "1" || !existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
    if (!m) continue;
    let val = m[2].trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (!process.env[m[1]] && val) process.env[m[1]] = val;
  }
}

function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

function deploymentsDir() {
  return path.resolve(AGENT_DIR, process.env.INSPECTOR_DEPLOYMENTS_DIR || "deployments");
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Mute echo: readline writes typed characters through _writeToOutput.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

interface WalletChoice {
  mode: string;
  load: () => Promise<Hex>;
}

function resolveWallet(): WalletChoice | null {
  const set = ["DEPLOYER_ACCOUNT", "DEPLOYER_KEYSTORE", "PRIVATE_KEY"].filter((k) => process.env[k]);
  if (set.length === 0) {
    bad("no wallet: set DEPLOYER_ACCOUNT (cast wallet keystore name, preferred), DEPLOYER_KEYSTORE or PRIVATE_KEY");
    return null;
  }
  if (set.length > 1) {
    bad(`set exactly one of DEPLOYER_ACCOUNT / DEPLOYER_KEYSTORE / PRIVATE_KEY (got ${set.join(", ")})`);
    return null;
  }
  if (process.env.PRIVATE_KEY) {
    const key = process.env.PRIVATE_KEY.trim();
    const hex = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
      bad("PRIVATE_KEY is not 32 bytes of hex");
      return null;
    }
    return { mode: "raw PRIVATE_KEY (discouraged)", load: async () => hex };
  }
  const file = process.env.DEPLOYER_KEYSTORE
    ? path.resolve(process.env.DEPLOYER_KEYSTORE)
    : path.join(process.env.FOUNDRY_KEYSTORES_DIR || path.join(homedir(), ".foundry", "keystores"), process.env.DEPLOYER_ACCOUNT!);
  if (!existsSync(file)) {
    bad(`keystore not found: ${file}`);
    return null;
  }
  return {
    mode: process.env.DEPLOYER_KEYSTORE ? `keystore file ${file}` : `keystore account '${process.env.DEPLOYER_ACCOUNT}'`,
    load: async () => {
      const pwFile = process.env.DEPLOYER_PASSWORD_FILE;
      const password = pwFile
        ? readFileSync(pwFile, "utf8").replace(/\r?\n$/, "")
        : process.stdin.isTTY
          ? await prompt("  keystore password: ", true)
          : die("keystore password needed: set DEPLOYER_PASSWORD_FILE or run in a terminal");
      return toHex(decryptKeystoreV3(JSON.parse(readFileSync(file, "utf8")), password));
    },
  };
}

interface Plan {
  rpcUrl: string;
  local: boolean;
  registry: Address;
  deployer: Address;
  signer: Address;
  publicUrl: string;
  wallet: WalletChoice | null;
  outFile: string;
  /** set-uri only: the existing record, the agentURI on-chain now, and the one to set. */
  record?: AgentDeployment;
  currentUri?: string;
  newUri?: string;
}

const services = (uri: string) =>
  uri.startsWith("data:")
    ? ((AgentURIGenerator.decodeRegistrationFileFromBase64(uri).services as { endpoint: string }[] | undefined) ?? []).map((e) => e.endpoint).join(", ")
    : uri;

async function preflight(setUri: boolean): Promise<Plan> {
  console.log(bold(`KeyScrow Inspector: ERC-8004 ${setUri ? "agentURI update" : "registration"} preflight (chainId ${CHAIN_ID})`));
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? "";
  const local = isLoopback(rpcUrl);
  if (!rpcUrl) bad("BSC_TESTNET_RPC_URL is not set");

  let registry = getAddress(NETWORKS[NETWORK].registryContract);
  if (process.env.ERC8004_REGISTRY_ADDRESS) {
    if (!isAddress(process.env.ERC8004_REGISTRY_ADDRESS)) bad("ERC8004_REGISTRY_ADDRESS is not an address");
    else {
      registry = getAddress(process.env.ERC8004_REGISTRY_ADDRESS);
      warn(`registry overridden by ERC8004_REGISTRY_ADDRESS: ${registry}`);
    }
  }

  const deployerEnv = process.env.DEPLOYER_ADDRESS ?? "";
  if (!isAddress(deployerEnv)) bad("DEPLOYER_ADDRESS must be set to the registering wallet's public address");
  const deployer = isAddress(deployerEnv) ? getAddress(deployerEnv) : ("0x" as Address);

  let signerEnv = process.env.INSPECTOR_SIGNER_ADDRESS ?? "";
  if (!signerEnv && process.env.INSPECTOR_PRIVATE_KEY) {
    signerEnv = privateKeyToAccount(process.env.INSPECTOR_PRIVATE_KEY.trim() as Hex).address;
  }
  if (!isAddress(signerEnv) && !setUri) bad("INSPECTOR_SIGNER_ADDRESS must be the address of the server's INSPECTOR_PRIVATE_KEY");
  const signer = isAddress(signerEnv) ? getAddress(signerEnv) : ("0x" as Address);

  const publicUrl = (process.env.AGENT_PUBLIC_URL ?? "").replace(/\/+$/, "");
  const urlOk = /^https?:\/\/[^/]+/.test(publicUrl);
  if (!urlOk) bad("AGENT_PUBLIC_URL must be the agent's public http(s) base URL");
  else if (!local && isLoopback(publicUrl) && setUri) bad(`AGENT_PUBLIC_URL ${publicUrl} is loopback: other agents cannot reach it`);
  else if (!local && isLoopback(publicUrl)) warn(`AGENT_PUBLIC_URL ${publicUrl} is loopback: other agents cannot reach it`);
  else ok(`endpoints: ${agentEndpoints(publicUrl).map((e) => `${e.name} ${e.endpoint}`).join(", ")}`);

  // Chain 97 is a public network even when rehearsed on a local anvil: anvil's public dev keys are always refused.
  for (const [name, addr] of [["DEPLOYER_ADDRESS", deployer], ["INSPECTOR_SIGNER_ADDRESS", signer]] as const) {
    if (isAddress(addr) && ANVIL_ACCOUNTS.some((a) => isAddressEqual(a as Address, addr))) {
      bad(`${name} is an anvil default account (its key is public): refused on chainId ${CHAIN_ID}`);
    }
  }

  const wallet = resolveWallet();
  if (wallet) ok(`wallet: ${wallet.mode}`);

  const outFile = path.join(deploymentsDir(), `${CHAIN_ID}.json`);
  const record = setUri ? readDeployment(outFile) : null;
  let newUri: string | undefined;
  if (setUri) {
    if (!record) bad(`${outFile} not found: register first (pnpm agent:register)`);
    else if (record.chainId !== CHAIN_ID || !isAddress(record.identityRegistry)) bad(`${outFile} is not a chainId-${CHAIN_ID} registration`);
    else if (urlOk) {
      if (!isAddressEqual(registry, record.identityRegistry)) bad(`registry ${registry} differs from the recorded ${record.identityRegistry}`);
      registry = getAddress(record.identityRegistry);
      // Same file ERC8004Agent.generateAgentUri builds (and registerAgent's phase 2 sets): registrations[] included.
      newUri = AgentURIGenerator.generateAgentUri({
        name: AGENT_NAME,
        description: AGENT_DESCRIPTION,
        endpoints: agentEndpoints(publicUrl),
        agentId: Number(record.agentId),
        identityRegistry: registry,
        chainId: CHAIN_ID,
      });
    }
  } else if (existsSync(outFile)) {
    const prev = JSON.parse(readFileSync(outFile, "utf8")) as AgentDeployment;
    if (process.env.FORCE_REREGISTER === "true") warn(`${outFile} exists (agent #${prev.agentId}); FORCE_REREGISTER=true registers a new agent`);
    else bad(`${outFile} exists: already registered as agent #${prev.agentId} (FORCE_REREGISTER=true to register again)`);
  }

  let currentUri: string | undefined;
  if (rpcUrl) {
    const client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
    try {
      const chainId = await client.getChainId();
      if (chainId === 56) die(`RPC answers chainId 56 (BSC MAINNET): refused. This script only registers on BSC testnet (97).`, 2);
      if (chainId !== CHAIN_ID) bad(`RPC answers chainId ${chainId}, expected ${CHAIN_ID}`);
      else ok(`RPC answers chainId ${chainId}${local ? " (loopback: local rehearsal)" : ""}`);
      const code = await client.getCode({ address: registry });
      if (!code || code === "0x") bad(`no contract at the Identity Registry ${registry}`);
      else {
        const [name, version] = await Promise.all([
          client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "name" }).catch(() => "?"),
          client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "getVersion" }).catch(() => "?"),
        ]);
        ok(`Identity Registry ${registry} (${name}, version ${version})`);
      }
      if (isAddress(deployer)) {
        const [bal, gasPrice] = await Promise.all([client.getBalance({ address: deployer }), client.getGasPrice()]);
        // register (~300-450k with a data: URI) + setAgentURI (~200-300k) at the network gas price, with headroom.
        const need = (setUri ? 600_000n : 1_500_000n) * gasPrice;
        if (bal < need) bad(`deployer ${deployer} has ${formatEther(bal)} BNB, needs about ${formatEther(need)} BNB`);
        else ok(`deployer ${deployer} balance ${formatEther(bal)} BNB`);
      }
      if (record && newUri) {
        const id = BigInt(record.agentId);
        const owner = await client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [id] });
        if (!isAddress(deployer) || !isAddressEqual(owner, deployer)) bad(`agent #${id} is owned by ${owner}, not DEPLOYER_ADDRESS ${deployer}`);
        else ok(`agent #${id} owner ${owner} = DEPLOYER_ADDRESS`);
        currentUri = await client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [id] });
        console.log(`    now: ${services(currentUri)}\n    new: ${services(newUri)}`);
        if (currentUri === newUri) warn(`agent #${id} already has this agentURI: nothing to send`);
      }
    } catch (err) {
      bad(`RPC ${rpcUrl} unreachable: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  if (isAddress(signer) && !setUri) ok(`reportSigner metadata: ${signer}`);
  return { rpcUrl, local, registry, deployer, signer, publicUrl, wallet, outFile, record: record ?? undefined, currentUri, newUri };
}

/** The broadcast guards, then an SDK agent on the decrypted wallet (throwaway wallets dir, removed afterwards). */
async function withAgent(plan: Plan, yes: boolean, word: string, question: string, fn: (agent: ERC8004Agent) => Promise<void>) {
  // Required on every chainId-97 RPC, loopback rehearsals included, so the rehearsal exercises the same guard.
  if (process.env.ALLOW_NON_LOCAL_BROADCAST !== "true") {
    die(`refusing to broadcast: set ALLOW_NON_LOCAL_BROADCAST=true to ${word} on BSC testnet`, 3);
  }
  if (!yes) {
    if (!process.stdin.isTTY) die(`no terminal for the confirmation: pass --yes to ${word} non-interactively`, 3);
    const answer = await prompt(`  ${question} Type "${word}": `);
    if (answer.trim() !== word) die("aborted", 3);
  }
  const key = await plan.wallet!.load();
  const account = privateKeyToAccount(key);
  if (!isAddressEqual(account.address, plan.deployer)) {
    die(`wallet is ${account.address} but DEPLOYER_ADDRESS is ${plan.deployer}`);
  }

  // Throwaway SDK wallet dir + password: the SDK re-encrypts the key there; it is removed when we are done.
  const walletsDir = mkdtempSync(path.join(tmpdir(), "keyescrow-agent-wallet-"));
  const wallet = new EVMWalletProvider({ password: randomBytes(24).toString("hex"), privateKey: key, walletsDir });
  try {
    const agent = await ERC8004Agent.create({
      walletProvider: wallet,
      network: {
        name: NETWORK,
        chainId: CHAIN_ID,
        rpcUrl: plan.rpcUrl,
        usePaymaster: false,
        registryContract: plan.registry,
        commerceContract: "",
        routerContract: "",
        policyContract: "",
      },
    });
    await fn(agent);
  } finally {
    wallet.destroy();
    rmSync(walletsDir, { recursive: true, force: true });
  }
}

function writeRecord(plan: Plan, record: AgentDeployment) {
  mkdirSync(path.dirname(plan.outFile), { recursive: true });
  writeFileSync(plan.outFile, `${JSON.stringify(record, null, 2)}\n`);
  const rel = path.relative(REPO_DIR, plan.outFile);
  ok(`wrote ${rel.startsWith("..") ? plan.outFile : rel}`);
}

async function register(plan: Plan, yes: boolean) {
  await withAgent(plan, yes, "register", `Register "${AGENT_NAME}" on chainId ${CHAIN_ID} from ${plan.deployer}?`, async (agent) => {
    const agentURI = agent.generateAgentUri({ name: AGENT_NAME, description: AGENT_DESCRIPTION, endpoints: agentEndpoints(plan.publicUrl) });
    console.log(bold("\nregistering…"));
    const res = await agent.registerAgent(agentURI, [{ key: REPORT_SIGNER_KEY, value: plan.signer }]);
    if (res.agentId === null) die(`register tx ${res.transactionHash} mined but no Registered event was found`);
    const info = await agent.getAgentInfo(res.agentId);
    const reader = createPublicClient({ transport: http(plan.rpcUrl) });
    const reportSigner = decodeReportSigner(
      await reader.readContract({
        address: plan.registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "getMetadata",
        args: [BigInt(res.agentId), REPORT_SIGNER_KEY],
      }),
    );
    if (!reportSigner || !isAddressEqual(reportSigner, plan.signer)) {
      die(`agent #${res.agentId} registered, but its reportSigner metadata reads back as ${reportSigner}, not ${plan.signer}`);
    }
    ok(`agent #${res.agentId} registered (tx ${res.transactionHash})`);
    ok(`owner ${info.owner}, agentWallet ${info.agentWallet}, reportSigner ${reportSigner}`);
    const record: AgentDeployment = {
      chainId: CHAIN_ID,
      network: NETWORK,
      agentId: String(res.agentId),
      identityRegistry: plan.registry,
      agentRegistry: `eip155:${CHAIN_ID}:${plan.registry}`,
      owner: info.owner,
      reportSigner,
      agentURI: info.agentURI,
      publicUrl: plan.publicUrl,
      registerTx: res.transactionHash,
      registeredAt: new Date().toISOString(),
      sdk: getBuiltWithValue(),
    };
    writeRecord(plan, record);
    console.log(bold("\nserver env (web/.env.local and the agent):"));
    console.log(`  INSPECTOR_AGENT_ID=${record.agentId}`);
    console.log(`  INSPECTOR_AGENT_REGISTRY=${record.agentRegistry}`);
    console.log(`  INSPECTOR_PRIVATE_KEY=<the key of ${plan.signer}>`);
  });
}

async function setUri(plan: Plan, yes: boolean) {
  const record = plan.record!;
  const newUri = plan.newUri!;
  if (plan.currentUri === newUri) die(`agent #${record.agentId} already has this agentURI; nothing was sent`);
  const question = `Point agent #${record.agentId} at ${plan.publicUrl} (setAgentURI on chainId ${CHAIN_ID}, from ${plan.deployer})?`;
  await withAgent(plan, yes, "set-uri", question, async (agent) => {
    console.log(bold("\nsetAgentURI…"));
    const res = await agent.setAgentUri(Number(record.agentId), newUri);
    // A load-balanced public RPC can serve the read from a node a block behind the receipt: retry briefly.
    let info = await agent.getAgentInfo(Number(record.agentId));
    for (let i = 0; i < 5 && info.agentURI !== newUri; i++) {
      await new Promise((r) => setTimeout(r, 3_000));
      info = await agent.getAgentInfo(Number(record.agentId));
    }
    // throw, not die(): the finally in withAgent must still remove the temp wallet dir.
    if (info.agentURI !== newUri) throw new Error(`setAgentURI tx ${res.transactionHash} mined, but tokenURI does not read back as the new file`);
    ok(`agent #${record.agentId} now lists ${services(newUri)} (tx ${res.transactionHash})`);
    writeRecord(plan, { ...record, agentURI: newUri, publicUrl: plan.publicUrl, setUriTx: res.transactionHash as Hex, updatedAt: new Date().toISOString() });
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cmds = ["check", "register", "set-uri-check", "set-uri"];
  if (!cmds.includes(cmd)) die("usage: register.ts check | register [--yes] | set-uri-check | set-uri [--yes]", 64);
  loadDotenv();
  const plan = await preflight(cmd.startsWith("set-uri"));
  if (fails > 0) die(`\n${fails} preflight check(s) failed; nothing was sent`);
  if (cmd.endsWith("check")) {
    const next = cmd === "check" ? "`pnpm agent:register` performs the registration" : "`pnpm agent:set-uri` sends setAgentURI";
    console.log(green(`\npreflight OK; nothing was sent. ${next}.`));
    return;
  }
  await (cmd === "set-uri" ? setUri : register)(plan, rest.includes("--yes"));
}

main().catch((err) => die(`failed: ${(err as Error).message}`));
