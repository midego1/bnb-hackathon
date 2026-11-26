#!/usr/bin/env node
// KeyScrow on Cloudflare Workers (OpenNext adapter). See docs/CLOUDFLARE.md.
//
//   node scripts/cf.mjs build        pnpm cf:build    chain 97 build into .open-next/ (refuses NEXT_PUBLIC_DEV_ACCOUNTS=1);
//                                                     CF_CHAIN_ID=56: the BSC mainnet stage Worker (wrangler env "mainnet")
//   node scripts/cf.mjs preview      pnpm cf:preview  serve that build locally with wrangler dev (workerd, no Cloudflare API)
//   node scripts/cf.mjs size         pnpm cf:size     gzip size of the bundle wrangler dev built, vs the Free/Paid limits
//   node scripts/cf.mjs deploy       pnpm cf:deploy   needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID; without them it
//                                                     only prints what it would deploy and exits 1
//   node scripts/cf.mjs typecheck    type-check web/cloudflare/*.ts against `wrangler types`
//   node scripts/cf.mjs next-build   the `next build` OpenNext runs (open-next.config.ts buildCommand); not for direct use
//
// Env: CF_CHAIN_ID (97 default, or 56: contracts/deployments/56.json, the Worker keyescrow-mainnet; preview and deploy
// follow the last build), CF_PREVIEW_PORT (default 8787), CF_DEMO_TESTNET (default 1: the build shows the live testnet
// /demo; 0 hides it; always off on 56), NEXT_PUBLIC_BSC_TESTNET_RPC_URL, NEXT_PUBLIC_BSC_RPC_URL,
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (public values baked into the bundle).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildMedia } from "./media.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..");
const OUT = join(WEB, ".open-next");
const MARKER = join(OUT, "keyescrow-build.json");
const CHAIN_ID = process.env.CF_CHAIN_ID || "97";
const DEPLOYMENT_FILE = join(REPO, "contracts", "deployments", `${CHAIN_ID}.json`);
/** The wrangler environment of each chain's Worker (wrangler.jsonc): 97 is the top level, 56 is env "mainnet". */
const WRANGLER_ENV = { 97: [], 56: ["--env", "mainnet"] };
const WORKER = { 97: "keyescrow-web", 56: "keyescrow-mainnet" };
const AGENT = join(REPO, "agent");
const MiB = 1024 * 1024;
const LIMITS = { free: 3 * MiB, paid: 10 * MiB };

/** Server-side secrets the Worker reads (wrangler secret put <NAME>). Names only: values never touch this repo. */
export const WEB_SECRETS = [
  ["ANTHROPIC_API_KEY", "optional", "live AI inspection in POST /api/settlement (mock without it)"],
  ["INSPECTOR_PRIVATE_KEY", "optional", "signs settlement reports as ERC-8004 agent #2921 (unsigned without it)"],
  ["CMC_API_KEY", "optional", "CoinMarketCap: /api/price, /api/risk deposit buffer (mock / 'not configured' without it)"],
  ["COURNOT_API_KEY", "optional", "Cournot oracle prepaid key (live calls also need the var COURNOT_LIVE=1)"],
  ["LIVING_BRAIN_API_KEY", "optional", "Living Brain inspection memory, with LIVING_BRAIN_SUBJECT_ID + LIVING_BRAIN_BRAIN_ID"],
  ["ATLAS_RPC_URL", "optional", "Atlas on-chain price feeds RPC (with the ATLAS_FEED_* vars)"],
  ["DEMO_TESTNET_KEYS", "optional", 'live testnet /demo: JSON {"landlord","tenant","arbiter"} private keys of the demo wallets'],
  ["DEMO_TESTNET_RPC_URL", "optional", "live testnet /demo: BSC testnet RPC the runner signs against (may embed an API key)"],
  ["DEMO_TESTNET_FUNDER_KEY", "optional", "live testnet /demo: small dedicated gas top-up wallet, never the deployer"],
  ["STAGE_PRESENTER_CODE", "optional", "live judge demo /stage: code for the presenter's Accept / Reset buttons (open without it)"],
  ["DEMO_MAINNET_OWNER_KEY", "56 only", "mainnet stage: the owner wallet that offers the rental and accepts the split (BNB for gas)"],
  ["DEMO_MAINNET_FUNDER_KEY", "56 only", "mainnet stage: the funder wallet that sends each judge 1 BSC-USD + 0.0003 BNB (not the deployer)"],
  ["DEMO_MAINNET_RPC_URL", "56 only", "mainnet stage: BSC mainnet RPC the server signs against (default NEXT_PUBLIC_BSC_RPC_URL / PublicNode)"],
];
export const AGENT_SECRETS = [
  ["INSPECTOR_PRIVATE_KEY", "optional", "the agent's report signer (must match reportSigner of agent #2921)"],
  ["ANTHROPIC_API_KEY", "optional", "live vision model (mock without it)"],
];

const fail = (msg) => {
  console.error(`cf: ${msg}`);
  process.exit(1);
};

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: WEB, ...opts });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  return r.status ?? 1;
};

/** wrangler/next never phone home, and preview/build never carry Cloudflare credentials. */
function quietEnv(extra = {}, { credentials = false } = {}) {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NEXT_TELEMETRY_DISABLED: "1", ...extra };
  if (!credentials) {
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    delete env.CLOUDFLARE_API_KEY;
    delete env.CLOUDFLARE_EMAIL;
  }
  return env;
}

// -------------------------------------------------------------------------------------------------------------------
// Build: chain 97 (or 56 with CF_CHAIN_ID=56), no dev accounts
// -------------------------------------------------------------------------------------------------------------------

function deployment() {
  if (!existsSync(DEPLOYMENT_FILE)) fail(`${relative(REPO, DEPLOYMENT_FILE)} is missing: deploy the contracts to chain ${CHAIN_ID} first`);
  const d = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
  if (String(d.chainId) !== CHAIN_ID) fail(`${relative(REPO, DEPLOYMENT_FILE)} is not a chain ${CHAIN_ID} deployment`);
  for (const k of ["escrowFactory", "token", "defaultArbiter"]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(d[k] ?? "")) fail(`${relative(REPO, DEPLOYMENT_FILE)}: ${k} is not an address`);
  }
  return d;
}

/** Refuse what must never reach a public build, whatever the caller's shell says. */
function assertPublicBuildEnv() {
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1") {
    fail("NEXT_PUBLIC_DEV_ACCOUNTS=1 is set. The Cloudflare build is public: the anvil dev accounts must be off. Unset it and retry.");
  }
  if (!(CHAIN_ID in WORKER)) fail(`CF_CHAIN_ID must be 97 (BSC testnet) or 56 (BSC mainnet stage), got ${CHAIN_ID}`);
  if (process.env.NEXT_PUBLIC_CHAIN_ID && process.env.NEXT_PUBLIC_CHAIN_ID !== CHAIN_ID) {
    fail(`NEXT_PUBLIC_CHAIN_ID=${process.env.NEXT_PUBLIC_CHAIN_ID} is set. The Cloudflare build targets chain ${CHAIN_ID} (CF_CHAIN_ID): anvil is not reachable from Cloudflare.`);
  }
  if (process.env.CF_DEMO_TESTNET && !["0", "1"].includes(process.env.CF_DEMO_TESTNET)) fail("CF_DEMO_TESTNET must be 0 or 1");
}

/**
 * The complete public env of the build: every NEXT_PUBLIC_* the app reads is set explicitly (Next's .env loader never
 * overrides a set variable), so a developer's web/.env.local (anvil addresses, dev accounts) cannot leak into the bundle.
 */
function buildEnv() {
  const d = deployment();
  return quietEnv({
    KEYESCROW_BUILD_TARGET: "cloudflare",
    NEXT_DIST_DIR: "", // OpenNext reads .next
    NEXT_PUBLIC_CHAIN_ID: CHAIN_ID,
    NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS: d.escrowFactory,
    NEXT_PUBLIC_MOCK_USDT_ADDRESS: d.token,
    NEXT_PUBLIC_DISPUTE_DESK_ADDRESS: d.defaultArbiter,
    NEXT_PUBLIC_FLEET_VAULT_ADDRESS: /^0x[0-9a-fA-F]{40}$/.test(d.fleetVault ?? "") ? d.fleetVault : "",
    NEXT_PUBLIC_DEV_ACCOUNTS: "0",
    NEXT_PUBLIC_DEMO_TESTNET: CHAIN_ID === "56" ? "0" : (process.env.CF_DEMO_TESTNET ?? "1"),
    NEXT_PUBLIC_RPC_URL: "",
    NEXT_PUBLIC_ANVIL_RPC_URL: "",
    NEXT_PUBLIC_BSC_TESTNET_RPC_URL: process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL ?? "",
    NEXT_PUBLIC_OPBNB_TESTNET_RPC_URL: process.env.NEXT_PUBLIC_OPBNB_TESTNET_RPC_URL ?? "",
    NEXT_PUBLIC_BSC_RPC_URL: process.env.NEXT_PUBLIC_BSC_RPC_URL ?? "",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  });
}

function nextBuild() {
  assertPublicBuildEnv();
  const env = buildEnv();
  console.log(`cf: next build for chain ${CHAIN_ID} (factory ${env.NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS}, live testnet demo ${env.NEXT_PUBLIC_DEMO_TESTNET === "1" ? "on" : "off"})`);
  buildMedia();
  process.exit(run("pnpm", ["exec", "next", "build"], { env: { ...env, ...openNextBuildVars() } }));
}

/** OpenNext sets these on its own process before calling buildCommand; keep them when we pass an explicit env. */
function openNextBuildVars() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("NEXT_PRIVATE_")));
}

const envFiles = () => readdirSync(WEB).filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.example");

/**
 * OpenNext copies web/.env* files into the Worker (.open-next/cloudflare/next-env.mjs, loaded into process.env at
 * runtime). On a public deploy every value must come from wrangler vars/secrets instead, so empty that module.
 */
function scrubEnvFiles() {
  const file = join(OUT, "cloudflare", "next-env.mjs");
  if (!existsSync(file)) fail(`${relative(WEB, file)} not found: did the OpenNext build change its layout?`);
  const src = readFileSync(file, "utf8");
  const names = [...new Set([...src.matchAll(/"([A-Z0-9_]+)":/g)].map((m) => m[1]))];
  writeFileSync(file, "// Emptied by scripts/cf.mjs: the deployed Worker gets its env from wrangler vars and secrets only.\nexport const production = {};\nexport const development = {};\nexport const test = {};\n");
  if (names.length) console.log(`cf: dropped ${names.length} variable(s) from web/.env* files out of the Worker bundle: ${names.join(", ")}`);
}

/**
 * The client bundle must not contain the anvil dev-account connector (constant-folded out when DEV_ACCOUNTS=0). Its
 * module's public constants (the well-known anvil addresses) may remain; the connector's own strings must not.
 */
const DEV_CONNECTOR_MARKERS = ["Anvil dev accounts", "Dev accounts only work on the local anvil chain"];
function assertNoDevAccounts() {
  const dir = join(OUT, "assets", "_next", "static");
  const hits = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".js")) {
        const src = readFileSync(p, "utf8");
        if (DEV_CONNECTOR_MARKERS.some((m) => src.includes(m))) hits.push(relative(WEB, p));
      }
    }
  };
  walk(dir);
  if (hits.length) fail(`the anvil dev-account connector is in the client bundle (${hits.join(", ")}). Refusing this build.`);
}

function build() {
  assertPublicBuildEnv();
  const files = envFiles();
  if (files.length) console.log(`cf: note: ${files.join(", ")} in web/ do not reach this build (public vars are pinned, the rest is scrubbed)`);
  const env = buildEnv();
  const status = run("pnpm", ["exec", "opennextjs-cloudflare", "build"], { env });
  if (status !== 0) fail(`opennextjs-cloudflare build failed (exit ${status})`);
  scrubEnvFiles();
  assertNoDevAccounts();
  // Copy the prerendered pages into the static assets (the read-only incremental cache, open-next.config.ts), as
  // `opennextjs-cloudflare deploy` does again before uploading, so the local preview serves exactly what deploys.
  if (run("pnpm", ["exec", "opennextjs-cloudflare", "populateCache", "local", ...WRANGLER_ENV[CHAIN_ID]], { env }) !== 0) fail("populating the static-assets cache failed");
  const marker = {
    target: "cloudflare",
    worker: WORKER[CHAIN_ID],
    chainId: Number(CHAIN_ID),
    escrowFactory: env.NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS,
    mockUsdt: env.NEXT_PUBLIC_MOCK_USDT_ADDRESS,
    disputeDesk: env.NEXT_PUBLIC_DISPUTE_DESK_ADDRESS,
    fleetVault: env.NEXT_PUBLIC_FLEET_VAULT_ADDRESS || null,
    devAccounts: false,
    demoTestnet: env.NEXT_PUBLIC_DEMO_TESTNET === "1",
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain") !== "",
    builtAt: new Date().toISOString(),
  };
  writeFileSync(MARKER, JSON.stringify(marker, null, 2) + "\n");
  console.log(`cf: build ready in web/.open-next (chain ${CHAIN_ID}, Worker ${marker.worker}, commit ${marker.commit}${marker.dirty ? " + local changes" : ""}). Next: pnpm cf:preview`);
}

function git(...args) {
  const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function readMarker() {
  if (!existsSync(MARKER)) return null;
  const m = JSON.parse(readFileSync(MARKER, "utf8"));
  if (m.target !== "cloudflare" || !(m.chainId in WORKER) || m.devAccounts !== false) fail("web/.open-next is not a chain 97 or 56 Cloudflare build: run pnpm cf:build");
  return m;
}

// -------------------------------------------------------------------------------------------------------------------
// Preview (local only) and size
// -------------------------------------------------------------------------------------------------------------------

function preview() {
  if (!readMarker()) fail("no Cloudflare build yet: run pnpm cf:build first");
  const port = process.env.CF_PREVIEW_PORT || "8787";
  console.log(`cf: local preview on http://127.0.0.1:${port} (wrangler dev, workerd; secrets for it go in web/.dev.vars)`);
  const m = readMarker();
  process.exit(run("pnpm", ["exec", "wrangler", "dev", "--ip", "127.0.0.1", "--port", port, "--local", "--show-interactive-dev-session=false", ...WRANGLER_ENV[m.chainId]], { env: quietEnv() }));
}

/** Gzip size of the newest bundle wrangler wrote under <dir>/.wrangler/tmp (what an upload would compress). */
function bundleSize(dir) {
  const tmp = join(dir, ".wrangler", "tmp");
  if (!existsSync(tmp)) return null;
  const builds = readdirSync(tmp)
    .map((f) => join(tmp, f))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, readdirSync(p).find((f) => /\.js$/.test(f)) ?? "-")))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!builds.length) return null;
  let raw = 0;
  let gz = 0;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (!f.endsWith(".map")) {
        const buf = readFileSync(p);
        raw += buf.length;
        gz += gzipSync(buf, { level: 9 }).length;
      }
    }
  };
  walk(builds[0]);
  return { dir: relative(REPO, builds[0]), raw, gz };
}

const fmt = (n) => `${(n / MiB).toFixed(2)} MiB`;

function size() {
  for (const [name, dir] of [
    [readMarker()?.worker ?? "keyescrow-web", WEB],
    ["keyescrow-agent", AGENT],
  ]) {
    const s = bundleSize(dir);
    if (!s) {
      console.log(`${name}: no wrangler bundle yet (run its preview once)`);
      continue;
    }
    const plan = s.gz <= LIMITS.free ? "fits Workers Free (3 MiB)" : s.gz <= LIMITS.paid ? "needs Workers Paid (10 MiB limit; Free is 3 MiB)" : "too big even for Workers Paid (10 MiB)";
    console.log(`${name}: ${fmt(s.raw)} raw, ${fmt(s.gz)} gzip -> ${plan}   [${s.dir}]`);
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Deploy: the only step that talks to Cloudflare, and only with credentials
// -------------------------------------------------------------------------------------------------------------------

/** CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the shell, else from the repo-root .env (only these two keys). */
function credentials() {
  const out = { token: process.env.CLOUDFLARE_API_TOKEN, account: process.env.CLOUDFLARE_ACCOUNT_ID, source: "env" };
  const file = join(REPO, ".env");
  if ((!out.token || !out.account) && existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (m[1] === "CLOUDFLARE_API_TOKEN" && !out.token && v) {
        out.token = v;
        out.source = "repo .env";
      }
      if (m[1] === "CLOUDFLARE_ACCOUNT_ID" && !out.account && v) out.account = v;
    }
  }
  return out;
}

function plan(target) {
  const m = target === "web" ? readMarker() : null;
  const lines = [];
  if (target === "web") {
    lines.push(`Worker ${m ? m.worker : "keyescrow-web"}  (web/wrangler.jsonc${m?.chainId === 56 ? ', env "mainnet"' : ""}, entry web/cloudflare/worker.ts -> .open-next/worker.js)`);
    lines.push(m ? `  build      chain ${m.chainId}, factory ${m.escrowFactory}, commit ${m.commit}${m.dirty ? " + local changes" : ""}, built ${m.builtAt}` : "  build      none yet (pnpm cf:build)");
    lines.push(`  route      https://${m ? m.worker : "keyescrow-web"}.<your-subdomain>.workers.dev (workers.dev only, no custom domain)`);
    lines.push("  bindings   ASSETS (static assets), KEYESCROW_STATE (Durable Object KeyEscrowState, SQLite, migration v1), WORKER_SELF_REFERENCE (this Worker, for Ask AI inspect_return)");
    lines.push("             EVIDENCE (R2) only if uncommented in wrangler.jsonc");
    lines.push("  secrets    " + WEB_SECRETS.map(([n]) => n).join(", "));
  } else {
    lines.push("Worker keyescrow-agent  (agent/wrangler.jsonc, entry agent/src/worker.ts)");
    lines.push("  route      https://keyescrow-agent.<your-subdomain>.workers.dev (agent card at /.well-known/agent-card.json)");
    lines.push("  secrets    " + AGENT_SECRETS.map(([n]) => n).join(", "));
  }
  const s = bundleSize(target === "web" ? WEB : AGENT);
  if (s) lines.push(`  size       ${fmt(s.gz)} gzip (Free limit 3 MiB, Paid 10 MiB)`);
  return lines.join("\n");
}

function deploy() {
  const target = process.argv.includes("--agent") ? "agent" : "web";
  const c = credentials();
  console.log(plan(target));
  if (!c.token || !c.account) {
    console.error(
      `\ncf: refusing to deploy: ${!c.token ? "CLOUDFLARE_API_TOKEN" : "CLOUDFLARE_ACCOUNT_ID"} is not set (shell or ${relative(process.cwd(), join(REPO, ".env")) || ".env"}).` +
        "\n    Nothing was sent to Cloudflare. See docs/CLOUDFLARE.md for the one-time setup.",
    );
    process.exit(1);
  }
  if (target === "web" && !readMarker()) fail("no Cloudflare build: run pnpm cf:build first");
  console.log(`\ncf: deploying with the token from ${c.source}`);
  const env = quietEnv({ CLOUDFLARE_API_TOKEN: c.token, CLOUDFLARE_ACCOUNT_ID: c.account }, { credentials: true });
  const status =
    target === "web"
      ? run("pnpm", ["exec", "opennextjs-cloudflare", "deploy", ...WRANGLER_ENV[readMarker().chainId]], { env })
      : run("pnpm", ["exec", "wrangler", "deploy"], { env, cwd: AGENT });
  process.exit(status);
}

function typecheck() {
  const env = quietEnv();
  if (run("pnpm", ["exec", "wrangler", "types", "cloudflare/worker-configuration.d.ts"], { env, stdio: ["ignore", "ignore", "inherit"] }) !== 0) fail("wrangler types failed");
  process.exit(run("pnpm", ["exec", "tsc", "-p", "cloudflare/tsconfig.json"]));
}

const commands = { build, "next-build": nextBuild, preview, size, deploy, typecheck };
const cmd = process.argv[2];
if (!commands[cmd]) fail(`usage: node scripts/cf.mjs <${Object.keys(commands).join("|")}>`);
commands[cmd]();
