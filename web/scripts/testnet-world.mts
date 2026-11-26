/**
 * The demo world: 3 fictional shops and 10 fictional renters (web/data/demo-world.json) with ~15 real rentals on
 * KeyEscrow: clean returns, small damages settled by agreement, disputes the desk resolved, one dispute still open,
 * active rentals and one unfunded offer. Every rental has pickup (and return) photos uploaded to the server and
 * anchored on-chain; returns get the AI inspection (POST /api/settlement) and settled rentals the per-wallet memory
 * (POST /api/history). The script never calls Living Brain or Claude itself: the server does, under its own caps.
 *
 *   pnpm testnet:world plan       the plan and its cost (tx count, gas, tBNB, AI calls, Living Brain writes); sends nothing
 *   pnpm testnet:world rehearse   the whole world on a throwaway anvil + a local server (mock AI, local memory), with asserts
 *   pnpm testnet:world run        BSC testnet (97). Needs ALLOW_NON_LOCAL_BROADCAST=true, WORLD_SERVER_URL and a typed
 *                                 confirmation (or WORLD_CONFIRM). Resumable: .orca/demo-world-state.json marks every
 *                                 step done, a re-run continues where it stopped (also after a crash mid-transaction).
 *
 * Env (repo-root .env, like scripts/testnet.mts; the shell wins):
 *   BSC_TESTNET_RPC_URL                          run (and plan; default PublicNode, reads only)
 *   DEPLOYER_KEYSTORE, DEPLOYER_PASSWORD_FILE, DEPLOYER_ADDRESS   run: the funder, also the dispute desk
 *   WORLD_SERVER_URL                             run: the live app (https); rehearse: an already running local server
 *                                                (default: `next start` of the web/.next build, on its own port)
 *   WORLD_GAS_TIP_GWEI                           1-2, default 1: added to the RPC's gas price
 *   WORLD_STATE_FILE                             default <main checkout>/.orca/demo-world-state.json
 *   WORLD_KEEP=1                                 rehearse: keep anvil + server up after PASS (to click through)
 * Keys: the personas' keys are generated into <main checkout>/.orca/secrets/demo-world/<id>.json (mode 600), never
 * printed. Their addresses go to web/data/demo-world-addresses.json (public, so the app can badge them).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  formatEther,
  formatGwei,
  formatUnits,
  getAddress,
  keccak256,
  parseEventLogs,
  parseGwei,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  amounts,
  budget,
  buildPlan,
  cost,
  disputeSplit,
  FUNDER,
  GAS,
  loadState,
  OPEN_DISPUTE_WINDOW_DAYS,
  PHOTOS,
  remaining,
  settles,
  validateWorld,
  walletTarget,
  type Addresses,
  type CatalogueListing,
  type Step,
  type World,
  type WorldRental,
  type WorldState,
} from "../lib/demoWorld.mts";
import { createChain97, EXPLORER, parseEnvFile, type Chain97 } from "../lib/server/chain97.mts";
import { loadDeployer, loadWallets } from "../lib/server/chain97-keys.mts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.dirname(WEB);
const CONTRACTS = path.join(ROOT, "contracts");
const mainCheckout = () => {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? path.dirname(r.stdout.trim()) : ROOT;
};
const MAIN = mainCheckout();
const envFile = [path.join(ROOT, ".env"), path.join(MAIN, ".env")].find(existsSync);
if (envFile) for (const [k, v] of Object.entries(parseEnvFile(readFileSync(envFile, "utf8")))) if (!process.env[k]) process.env[k] = v;

const WORLD_FILE = path.join(WEB, "data/demo-world.json");
const ADDRESSES_FILE = path.join(WEB, "data/demo-world-addresses.json");
const world = JSON.parse(readFileSync(WORLD_FILE, "utf8")) as World;
const listingsJson = JSON.parse(readFileSync(path.join(WEB, "data/listings.json"), "utf8")) as { thbPerUsdt: number; listings: CatalogueListing[] };
const catalogue = listingsJson.listings;
const THB_PER_USDT = listingsJson.thbPerUsdt;
validateWorld(world, catalogue);
const plan = buildPlan(world);
const rentalOf = (id: string) => world.rentals.find((r) => r.id === id)!;
const listingOf = (slug: string) => catalogue.find((c) => c.slug === slug)!;
const shopOf = (id: string) => world.shops.find((s) => s.id === id)!;

const abi = (name: string): Abi => {
  const file = path.join(CONTRACTS, "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(file)) throw new Error(`missing ${file}: run \`cd contracts && forge build\` first`);
  return JSON.parse(readFileSync(file, "utf8")).abi as Abi;
};
const tokenAbi = abi("MockUSDT");
const factoryAbi = abi("EscrowFactory");
const escrowAbi = abi("RentalEscrow");

const Status = { Created: 0, Active: 1, MoveOut: 2, Disputed: 3, Settled: 4 } as const;
const fmtUsdt = (v: bigint) => `${formatUnits(v, 6)} mUSDT`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Uint8Array) => `0x${createHash("sha256").update(b).digest("hex")}` as Hex;

// ---------------------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------------------

type Deployment = { escrowFactory: Address; token: Address; fleetVault?: Address; defaultArbiter: Address };
type Ctx = {
  chainId: number;
  c: Chain97;
  d: Deployment;
  server: string;
  funder: PrivateKeyAccount;
  desk: PrivateKeyAccount;
  who: Record<string, PrivateKeyAccount>;
  state: WorldState;
  save: () => void;
  /** Test hook (rehearse): throw right after this many transactions were broadcast, before their receipt. */
  crashAfter?: number;
  sent: number;
  counts: { ai: number; aiLive: number; captures: number; evidence: number };
};

const addr = (ctx: Ctx, id: string) => (id === FUNDER ? ctx.funder.address : ctx.who[id].address);
const escrowOf = (ctx: Ctx, rental: string) => ctx.state.steps[`${rental}:create`]?.result?.escrow as Address;
const result = <T,>(ctx: Ctx, key: string) => ctx.state.steps[key]?.result as T;

/** Gas price: the RPC's, plus a tip of WORLD_GAS_TIP_GWEI (1-2 gwei, default 1). Refused above 10 gwei. */
async function gasPrice(pubGasPrice: () => Promise<bigint>) {
  const tip = Number(process.env.WORLD_GAS_TIP_GWEI || "1");
  if (!(tip >= 1 && tip <= 2)) throw new Error("WORLD_GAS_TIP_GWEI must be 1-2");
  const price = (await pubGasPrice()) + parseGwei(String(tip));
  if (price > parseGwei("10")) throw new Error(`gas price ${formatGwei(price)} gwei is over 10 gwei: refusing`);
  return price;
}

// ---------------------------------------------------------------------------------------------------------
// Server calls (the app's own API; it applies its caps and calls Claude / Living Brain itself)
// ---------------------------------------------------------------------------------------------------------

async function api<T>(ctx: Ctx, p: string, init?: RequestInit, tries = 4): Promise<{ status: number; body: T }> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${ctx.server}${p}`, { ...init, signal: AbortSignal.timeout(120_000) });
      const body = (await res.json().catch(() => ({}))) as T;
      if (res.status >= 500 && i < tries) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      return { status: res.status, body };
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`      ${p}: ${(e as Error).message.split("\n")[0]}; retry ${i}/${tries - 1} in ${5 * i} s`);
      await sleep(5_000 * i);
    }
  }
}
const postJson = <T,>(ctx: Ctx, p: string, body: unknown) => api<T>(ctx, p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function upload(ctx: Ctx, files: { name: string; bytes: Uint8Array }[]): Promise<Hex[]> {
  const form = new FormData();
  for (const f of files) form.append("file", new Blob([new Uint8Array(f.bytes)], { type: "image/jpeg" }), f.name);
  const { status, body } = await api<{ items?: { hash: Hex }[]; error?: string }>(ctx, "/api/evidence", { method: "POST", body: form });
  if (status !== 201 || !body.items) throw new Error(`POST /api/evidence ${status}: ${body.error ?? ""}`);
  const hashes = body.items.map((i) => i.hash.toLowerCase() as Hex);
  files.forEach((f, i) => {
    if (hashes[i] !== sha256(f.bytes)) throw new Error(`evidence hash mismatch for ${f.name}`);
  });
  ctx.counts.evidence += files.length;
  return hashes;
}

// ---------------------------------------------------------------------------------------------------------
// Photos: the catalogue photo with small variations (crop, brightness), damage drawn on return photos
// ---------------------------------------------------------------------------------------------------------

type Sharp = (input: Buffer | string) => {
  extract(o: { left: number; top: number; width: number; height: number }): ReturnType<Sharp>;
  modulate(o: { brightness: number }): ReturnType<Sharp>;
  resize(w: number, h: number): ReturnType<Sharp>;
  composite(o: { input: Buffer }[]): ReturnType<Sharp>;
  jpeg(o: { quality: number }): ReturnType<Sharp>;
  toBuffer(): Promise<Buffer>;
};
let sharpFn: Sharp | undefined;
/** sharp ships with Next.js (its image optimiser): no extra dependency. */
function sharp(): Sharp {
  const req = createRequire(import.meta.url);
  return (sharpFn ??= createRequire(req.resolve("next/package.json"))("sharp") as Sharp);
}

const seedOf = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);

function damageSvg(kind: string, seed: number) {
  const W = 960, H = 720;
  const x = 300 + (seed % 300), y = 330 + (seed % 120);
  const path_ = (d: string, w: number, c: string) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  let body = "";
  if (kind === "scratch") {
    for (let i = 0; i < 4; i++) {
      const d = `M${x + i * 9} ${y + i * 7} l60 ${-8 + i * 3} l55 ${10 - i * 2} l70 ${-6 + i} l50 ${8 - i * 2}`;
      body += path_(d, 7, "rgba(40,40,40,0.55)") + path_(d, 3, "rgba(245,245,245,0.95)");
    }
  } else {
    const cx = kind === "mirror" ? 180 + (seed % 120) : x, cy = kind === "mirror" ? 150 + (seed % 60) : y;
    const arms = kind === "mirror" ? 7 : 5;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + (seed % 10) / 10, r1 = 45 + ((seed >>> i) % 40), r2 = r1 + 40 + ((seed >>> (i + 3)) % 50);
      const d = `M${cx} ${cy} L${(cx + Math.cos(a) * r1).toFixed(0)} ${(cy + Math.sin(a) * r1).toFixed(0)} L${(cx + Math.cos(a + 0.25) * r2).toFixed(0)} ${(cy + Math.sin(a + 0.25) * r2).toFixed(0)}`;
      body += path_(d, 6, "rgba(15,15,15,0.85)") + path_(d, 2, "rgba(255,255,255,0.9)");
    }
    if (kind === "mirror") body += `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="rgba(15,15,15,0.85)" stroke-width="5"/>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);
}

/** One photo of a rental's set, deterministic (same bytes on a re-run, so a resume re-uploads the same hash). */
async function photo(r: WorldRental, set: "pickup" | "return", i: number): Promise<Uint8Array> {
  const seed = seedOf(`${r.id}:${set}:${i}`);
  const src = path.join(WEB, "public", listingOf(r.listing).photos[0]); // 1200 x 900
  const width = 1000 + (seed % 120), height = Math.round((width * 3) / 4);
  const left = i === 0 ? seed % (1200 - width + 1) : 1200 - width - (seed % 40);
  const top = (seed >>> 4) % (900 - height + 1);
  let img = sharp()(src).extract({ left, top, width, height }).modulate({ brightness: 0.9 + ((seed >>> 8) % 21) / 100 }).resize(960, 720);
  if (set === "return" && r.damage && i === 0) img = img.composite([{ input: damageSvg(r.damage, seed) }]);
  return new Uint8Array(await img.jpeg({ quality: 78 }).toBuffer());
}
const LABELS = ["front three-quarter", "side and rear"];

// ---------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------

type Call = { who: PrivateKeyAccount; address: Address; abi: Abi; functionName: string; args?: readonly unknown[] } | { who: PrivateKeyAccount; to: Address; value: bigint };

/** The transaction a step sends, or null when there is nothing to send (a wallet already holds enough). */
async function callFor(ctx: Ctx, s: Extract<Step, { tx: unknown }>): Promise<Call | null> {
  const pub = ctx.c.pub;
  if (s.tx === "transfer") {
    const left = cost(remaining(plan, ctx.state)).gasBy[s.to!] ?? BigInt(0);
    const short = walletTarget(left, ctx.c.gasPrice) - (await pub.getBalance({ address: addr(ctx, s.to!) }));
    return short > BigInt(0) ? { who: ctx.funder, to: addr(ctx, s.to!), value: short } : null;
  }
  if (s.tx === "faucet") {
    const need = world.rentals.filter((r) => r.renter === s.to).reduce((sum, r) => sum + amounts(r, catalogue, THB_PER_USDT).funded, BigInt(0));
    const have = (await pub.readContract({ address: ctx.d.token, abi: tokenAbi, functionName: "balanceOf", args: [addr(ctx, s.to!)] })) as bigint;
    return need > have ? { who: ctx.funder, address: ctx.d.token, abi: tokenAbi, functionName: "faucet", args: [addr(ctx, s.to!), need - have] } : null;
  }
  const r = rentalOf(s.rental!);
  const { rent, deposit, funded } = amounts(r, catalogue, THB_PER_USDT);
  const escrow = escrowOf(ctx, r.id);
  const me = s.actor === FUNDER ? ctx.desk : ctx.who[s.actor];
  const on = (functionName: string, args: readonly unknown[] = []) => ({ who: me, address: escrow, abi: escrowAbi, functionName, args });
  switch (s.tx) {
    case "createLease": {
      const params = {
        tenant: addr(ctx, r.renter),
        arbiter: zeroAddress, // the factory's dispute desk
        rentAmount: rent,
        depositAmount: deposit,
        termPeriods: r.termPeriods,
        rentPeriod: r.periodDays * 86_400,
        responseWindow: 0,
        arbiterWindow: r.outcome === "open-dispute" ? OPEN_DISPUTE_WINDOW_DAYS * 86_400 : 0,
        leaseHash: keccak256(toHex(`KeyEscrow DEMO world rental ${r.id}: ${r.listing} from ${shopOf(r.shop).name}`)),
      };
      const vault = shopOf(r.shop).vault && ctx.d.fleetVault;
      return vault
        ? { who: me, address: ctx.d.escrowFactory, abi: factoryAbi, functionName: "createLeaseWithPayee", args: [params, vault] }
        : { who: me, address: ctx.d.escrowFactory, abi: factoryAbi, functionName: "createLease", args: [params] };
    }
    case "approve":
      return { who: me, address: ctx.d.token, abi: tokenAbi, functionName: "approve", args: [escrow, funded] };
    case "fund":
      return on("fund");
    case "payRent":
      return on("payRent", [r.prepay]);
    case "addEvidence":
      return on("addEvidence", [s.set === "pickup" ? 0 : 1, result<{ hashes: Hex[] }>(ctx, `${r.id}:photos:${s.set}`).hashes[s.index!]]);
    case "releaseRent":
      return on("releaseRent");
    case "propose": {
      if (r.outcome === "clean" || r.outcome === "damage") {
        const ai = result<{ tenantRefund: string; reportHash: Hex }>(ctx, `${r.id}:ai`);
        return on("propose", [BigInt(ai.tenantRefund), ai.reportHash]);
      }
      const { claim, ownerProposalRefund } = disputeSplit(r, deposit);
      return on("propose", [ownerProposalRefund, keccak256(toHex(`DEMO owner claim ${r.id}: ${fmtUsdt(claim)} (${r.ownerClaimPct}% of the deposit) for ${r.damage ?? "damage"} at return`))]);
    }
    case "accept": {
      const p = (await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "proposal" })) as { nonce: number };
      return on("accept", [p.nonce]);
    }
    case "dispute":
      return on("dispute");
    case "resolve": {
      const { rulingRefund } = disputeSplit(r, deposit);
      return on("resolve", [rulingRefund, keccak256(toHex(JSON.stringify({ rental: r.id, escrow, tenantRefund: String(rulingRefund), reason: r.ruling!.reason })))]);
    }
  }
}

async function txStep(ctx: Ctx, s: Extract<Step, { tx: unknown }>) {
  const st = (ctx.state.steps[s.key] ??= {});
  let receipt: TransactionReceipt | undefined;
  if (st.pending) {
    // Sent before a crash: its receipt decides (a dropped tx is sent again below).
    receipt = await ctx.c.wait(st.pending as Hash).catch(() => undefined);
    if (receipt?.status !== "success") delete st.pending;
  }
  if (!receipt || receipt.status !== "success") {
    const call = await callFor(ctx, s);
    if (!call) {
      ctx.state.steps[s.key] = { done: true, result: { skipped: true } };
      ctx.save();
      return console.log(`    --  ${s.key.padEnd(30)} nothing to send`);
    }
    const hash = "to" in call ? await ctx.c.sendValue(call.who, call.to, call.value) : (await ctx.c.sendCall(call.who, call)).hash;
    st.pending = hash;
    ctx.save();
    if (ctx.crashAfter !== undefined && ++ctx.sent >= ctx.crashAfter) throw new Error(`rehearse: simulated crash after broadcasting ${s.key}`);
    receipt = await ctx.c.wait(hash);
    if (receipt.status !== "success") throw new Error(`${s.key} reverted: ${hash}`);
  }
  const res: Record<string, unknown> = { hash: receipt.transactionHash, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed) };
  if (s.tx === "createLease") {
    const [ev] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "LeaseCreated" }) as unknown as { args: { escrow: Address } }[];
    res.escrow = getAddress(ev.args.escrow);
  }
  ctx.state.steps[s.key] = { done: true, result: res };
  ctx.save();
  const over = receipt.gasUsed > GAS[s.tx] ? `  (over the ${GAS[s.tx]} gas table!)` : "";
  console.log(`    ok  ${s.key.padEnd(30)} ${String(receipt.gasUsed).padStart(7)} gas  ${ctx.chainId === 97 ? `${EXPLORER}/tx/` : ""}${receipt.transactionHash}${over}`);
}

async function offStep(ctx: Ctx, s: Extract<Step, { off: unknown }>) {
  let res: Record<string, unknown>;
  const q = `?chainId=${ctx.chainId}`;
  if (s.off === "fleet") {
    const shop = shopOf(s.shop!), l = listingOf(s.listing!);
    const owner = addr(ctx, shop.id);
    const find = (d: { scooters: { id: string; owner: string; name: string; location: string }[] }) =>
      d.scooters.find((x) => x.owner.toLowerCase() === owner.toLowerCase() && x.name === l.name && x.location === l.location);
    let found = find((await api<{ scooters: never[] }>(ctx, `/api/fleet${q}`)).body);
    if (!found) {
      const bytes = new Uint8Array(await sharp()(path.join(WEB, "public", l.photos[0])).resize(960, 720).jpeg({ quality: 78 }).toBuffer());
      const [hash] = await upload(ctx, [{ name: `${l.slug}.jpg`, bytes }]);
      const add = { action: "addScooter", owner, name: l.name, location: l.location, rentThb: l.monthThb, depositThb: l.depositThb, vault: !!shop.vault, photo: `/api/evidence/${hash}` };
      const { status, body } = await postJson<{ scooters: never[]; error?: string }>(ctx, `/api/fleet${q}`, add);
      if (status !== 200) throw new Error(`addScooter ${status}: ${body.error}`);
      found = find(body);
    }
    res = { scooterId: found!.id };
  } else if (s.off === "link") {
    const r = rentalOf(s.rental!);
    const scooterId = result<{ scooterId: string }>(ctx, `fleet:${r.shop}:${r.listing}`).scooterId;
    const { status, body } = await postJson<{ error?: string }>(ctx, `/api/fleet${q}`, { action: "linkRental", scooterId, lease: escrowOf(ctx, r.id) });
    if (status !== 200) throw new Error(`linkRental ${status}: ${body.error}`);
    res = { scooterId };
  } else if (s.off === "photos") {
    const r = rentalOf(s.rental!);
    const files = [];
    for (let i = 0; i < PHOTOS; i++) files.push({ name: `${r.id}-${s.set}-${i + 1}.jpg`, bytes: await photo(r, s.set!, i) });
    res = { hashes: await upload(ctx, files) };
  } else if (s.off === "ai") {
    const r = rentalOf(s.rental!);
    const set = (k: "pickup" | "return") => result<{ hashes: Hex[] }>(ctx, `${r.id}:photos:${k}`).hashes.map((hash, i) => ({ hash, label: LABELS[i] }));
    const notes = r.damage
      ? `DEMO rental. Renter's note at return: ${{ mirror: "the left mirror glass cracked while parked", scratch: "a scrape along the side panel after a low-speed slide", crack: "a knock on the front fairing in traffic" }[r.damage]}.`
      : "DEMO rental. Renter's note at return: no incidents.";
    const req = { deposit: String(amounts(r, catalogue, THB_PER_USDT).deposit), checkIn: set("pickup"), checkOut: set("return"), notes, lease: escrowOf(ctx, r.id), chainId: ctx.chainId };
    for (let i = 0; ; i++) {
      const { status, body } = await postJson<Record<string, unknown> & { error?: string }>(ctx, "/api/settlement", req);
      if (status === 200) {
        res = { tenantRefund: body.tenantRefund, landlordClaim: body.landlordClaim, reportHash: body.reportHash, mock: body.mock, fallback: body.fallback ?? null, reasons: body.reasons };
        break;
      }
      // 10 live inspections an hour per caller IP: wait for the window instead of failing the world half-way.
      const min = Number(/about (\d+) min/.exec(body.error ?? "")?.[1] ?? 0);
      if (status !== 429 || !min || i >= 2) throw new Error(`POST /api/settlement ${status}: ${body.error ?? ""}`);
      console.log(`      AI inspections are rate limited for this IP: waiting ${min} min (the state file keeps everything so far)`);
      await sleep(Math.min(min, 61) * 60_000);
    }
    ctx.counts.ai++;
    if (!res.mock) ctx.counts.aiLive++;
    if (!res.fallback) ctx.counts.captures++; // the server writes the scooter memory unless the demo inspector stood in
    console.log(`    ai  ${s.key.padEnd(30)} owner ${fmtUsdt(BigInt(res.landlordClaim as string))}, renter ${fmtUsdt(BigInt(res.tenantRefund as string))}${res.mock ? ` (demo inspector${res.fallback ? `: ${res.fallback}` : ""})` : ""}`);
  } else {
    // history: once the server's chain index has the settlement, one capture per party.
    const r = rentalOf(s.rental!);
    const block = result<{ block: number }>(ctx, `${r.id}:${r.outcome === "dispute" ? "resolve" : "accept"}`).block;
    for (let i = 1; ; i++) {
      await api(ctx, `/api/chain/index${q}&minBlock=${block}`);
      const { status, body } = await postJson<{ stored?: number; skipped?: number; reason?: string; error?: string }>(ctx, "/api/history", { lease: escrowOf(ctx, r.id), chainId: ctx.chainId });
      if (status !== 200) throw new Error(`POST /api/history ${status}: ${body.error ?? ""}`);
      if (body.reason === "rate-limited") {
        console.log(`    --  ${s.key.padEnd(30)} memory writes rate limited (20/hour/IP): left for the next run`);
        return;
      }
      if (body.reason !== "not-settled" || i >= 6) {
        res = body as Record<string, unknown>;
        break;
      }
      await sleep(10_000); // the index lags the chain by a few blocks on a public RPC
    }
    ctx.counts.captures += Number(res.stored ?? 0);
    console.log(`    mem ${s.key.padEnd(30)} stored ${res.stored}, skipped ${res.skipped}${res.reason ? ` (${res.reason})` : ""}`);
  }
  ctx.state.steps[s.key] = { done: true, result: res };
  ctx.save();
}

async function runWorld(ctx: Ctx) {
  for (const s of plan) {
    if (ctx.state.steps[s.key]?.done) continue;
    if ("tx" in s) await txStep(ctx, s);
    else await offStep(ctx, s);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Plan output
// ---------------------------------------------------------------------------------------------------------

function printPlan(state: WorldState | undefined, price: bigint, funderBal?: bigint, walletBals: Record<string, bigint> = {}) {
  const todo = state ? remaining(plan, state) : plan;
  const all = cost(plan), c = cost(todo);
  console.log(`Demo world: ${world.shops.length} shops, ${world.renters.length} renters, ${world.rentals.length} rentals (all DEMO personas)`);
  for (const r of world.rentals) {
    const { rent, deposit } = amounts(r, catalogue, THB_PER_USDT);
    const renter = world.renters.find((x) => x.id === r.renter)!;
    const extra = r.outcome === "dispute" ? ` claim ${r.ownerClaimPct}%, desk gives owner ${r.ruling!.ownerSharePct}% of it` : r.outcome === "open-dispute" ? ` claim ${r.ownerClaimPct}%, left open` : r.prepay ? ` +${r.prepay} period prepaid` : r.damage ? ` ${r.damage}` : "";
    console.log(`  ${r.id} ${shopOf(r.shop).name.padEnd(27)} ${r.listing.padEnd(20)} ${`${renter.flag} ${renter.name}`.padEnd(10)} ${String(r.periodDays).padStart(2)}d x${r.termPeriods}  rent ${fmtUsdt(rent).padStart(13)}  deposit ${fmtUsdt(deposit).padStart(13)}  ${r.outcome}${extra}`);
  }
  console.log(`\nSteps: ${plan.length} (${todo.length} left${state ? `, state file has ${plan.length - todo.length} done` : ""})`);
  console.log(`  transactions   ${c.txs} of ${all.txs}, ~${c.gas} gas at ${formatGwei(price)} gwei = ${formatEther(c.gas * price)} tBNB`);
  console.log(`  evidence       ${c.evidenceUploads} photos uploaded (+1 per scooter listing), each anchored with addEvidence`);
  console.log(`  AI inspections ${c.aiCalls} POST /api/settlement (live Claude while the server's caps allow; ~$0.03 each; the server allows 10/hour per IP, the script waits when it hits that)`);
  console.log(`  Living Brain   at most ${c.livingBrainWrites} captures by the server: ${c.aiCalls} scooter inspections + ${c.historyCalls} x 2 per-wallet (POST /api/history); the script calls Living Brain never`);
  if (funderBal !== undefined) {
    const b = budget(c, price, funderBal, walletBals);
    console.log(`  tBNB needed    ${formatEther(b.need)} (wallet top-ups ${formatEther(b.topUps)} incl. 50% margin + funder/desk own gas ${formatEther(b.own)})`);
    console.log(`  funder holds   ${formatEther(funderBal)}; after the run ${formatEther(b.left)}; reserve 0.02 -> ${b.ok ? "OK" : "REFUSED: not enough tBNB"}`);
    return b;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------------------

function saveAddresses(chainId: number, who: Record<string, PrivateKeyAccount>) {
  const all = JSON.parse(readFileSync(ADDRESSES_FILE, "utf8")) as Addresses;
  const mine = Object.fromEntries([...world.shops, ...world.renters].map((p) => [p.id, who[p.id].address]));
  if (JSON.stringify(all[String(chainId)]) === JSON.stringify(mine)) return false;
  all[String(chainId)] = mine;
  writeFileSync(ADDRESSES_FILE, JSON.stringify(all, null, 2) + "\n");
  return true;
}

const stateFile = () => process.env.WORLD_STATE_FILE ?? path.join(MAIN, ".orca/demo-world-state.json");

async function cmdPlan() {
  const rpc = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
  const d = JSON.parse(readFileSync(path.join(CONTRACTS, "deployments/97.json"), "utf8")) as Deployment & { deployer: Address };
  const c = createChain97({ rpc, gasPrice: BigInt(1) });
  await c.assertChain97();
  const price = await gasPrice(() => c.pub.getGasPrice());
  const funder = getAddress(process.env.DEPLOYER_ADDRESS || d.deployer);
  const file = stateFile();
  const state = existsSync(file) ? loadState(readFileSync(file, "utf8"), 97, d.escrowFactory) : undefined;
  const known = (JSON.parse(readFileSync(ADDRESSES_FILE, "utf8")) as Addresses)["97"] ?? {};
  const bals: Record<string, bigint> = {};
  for (const [id, a] of Object.entries(known)) bals[id] = await c.pub.getBalance({ address: a as Address });
  console.log(`BSC testnet (97) via ${new URL(rpc).host}; RPC gas price + ${process.env.WORLD_GAS_TIP_GWEI || 1} gwei tip = ${formatGwei(price)} gwei; funder/desk ${funder}`);
  printPlan(state, price, await c.pub.getBalance({ address: funder }), bals);
  console.log("\nplan only: nothing was sent.");
}

async function cmdRun() {
  if (process.env.ALLOW_NON_LOCAL_BROADCAST !== "true") throw new Error("set ALLOW_NON_LOCAL_BROADCAST=true to broadcast on BSC testnet");
  const server = (process.env.WORLD_SERVER_URL ?? "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(server)) throw new Error("set WORLD_SERVER_URL to the live app (https://...)");
  const rpc = process.env.BSC_TESTNET_RPC_URL;
  if (!rpc) throw new Error("BSC_TESTNET_RPC_URL is not set");
  const d = JSON.parse(readFileSync(path.join(CONTRACTS, "deployments/97.json"), "utf8")) as Deployment;
  const probe = createChain97({ rpc, gasPrice: BigInt(1) });
  await probe.assertChain97();
  const c = createChain97({ rpc, gasPrice: await gasPrice(() => probe.pub.getGasPrice()) });
  const funder = loadDeployer(process.env);
  const desk = (await c.pub.readContract({ address: d.escrowFactory, abi: factoryAbi, functionName: "defaultArbiter" })) as Address;
  if (getAddress(desk) !== funder.address) throw new Error(`the factory's dispute desk ${desk} is not the deployer: the script cannot resolve the disputes`);

  const dir = path.join(MAIN, ".orca/secrets/demo-world");
  const note = "KeyEscrow DEMO world persona wallet, BSC testnet (97) only. Never fund on mainnet. Never commit.";
  const who: Record<string, PrivateKeyAccount> = {};
  for (const p of [...world.shops, ...world.renters]) who[p.id] = loadWallets(path.join(dir, `${p.id}.json`), ["wallet"] as const, { create: true, note })!.accounts.wallet;
  if (saveAddresses(97, who)) console.log(`wrote the persona addresses to ${path.relative(ROOT, ADDRESSES_FILE)}: commit it so the app shows the demo persona badges`);

  const file = stateFile();
  const state = loadState(existsSync(file) ? readFileSync(file, "utf8") : undefined, 97, d.escrowFactory);
  const bals: Record<string, bigint> = {};
  for (const [id, a] of Object.entries(who)) bals[id] = await c.pub.getBalance({ address: a.address });
  console.log(`BSC testnet (97), server ${server}, funder/desk ${funder.address}`);
  const b = printPlan(state, c.gasPrice, await c.pub.getBalance({ address: funder.address }), bals)!;
  if (!b.ok) throw new Error("not enough tBNB on the funder for this plan (0.02 reserve kept): refusing");

  const phrase = "run demo world on 97";
  let typed = process.env.WORLD_CONFIRM;
  if (typed === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    typed = await rl.question(`\nType "${phrase}" to broadcast: `);
    rl.close();
  }
  if (typed.trim() !== phrase) throw new Error("not confirmed: nothing sent");

  mkdirSync(path.dirname(file), { recursive: true });
  const ctx: Ctx = { chainId: 97, c, d, server, funder, desk: funder, who, state, save: () => writeFileSync(file, JSON.stringify(state, null, 2)), sent: 0, counts: { ai: 0, aiLive: 0, captures: 0, evidence: 0 } };
  ctx.save();
  await runWorld(ctx);
  summary(ctx);
}

function summary(ctx: Ctx) {
  const left = remaining(plan, ctx.state);
  const gas = Object.values(ctx.state.steps).reduce((s, st) => s + Number(st.result?.gasUsed ?? 0), 0);
  console.log(`\nThis run: ${ctx.counts.ai} AI inspections (${ctx.counts.aiLive} live model), ${ctx.counts.captures} Living Brain captures by the server, ${ctx.counts.evidence} photos uploaded.`);
  console.log(`World: ${plan.length - left.length}/${plan.length} steps done, ${gas} gas used in all.${left.length ? ` Left: ${left.map((s) => s.key).join(", ")} (run again to continue).` : ""}`);
  for (const r of world.rentals) console.log(`  ${r.id} ${r.outcome.padEnd(12)} ${escrowOf(ctx, r.id) ?? "-"}`);
}

// ---------------------------------------------------------------------------------------------------------
// Rehearse: throwaway anvil + local server, the full world, then asserts
// ---------------------------------------------------------------------------------------------------------

// Anvil's public default dev keys (local only): #0 deployer/funder, #3 the default dispute desk (Deploy.s.sol).
const ANVIL_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_3 = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(true));
  });
async function waitFor(what: string, ok: () => Promise<boolean>, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) if (await ok().catch(() => false)) return;
  throw new Error(`${what} did not come up`);
}

async function cmdRehearse() {
  const anvilPort = Number(process.env.WORLD_ANVIL_PORT ?? 28547);
  const webPort = Number(process.env.WORLD_WEB_PORT ?? 3170);
  const rpc = `http://127.0.0.1:${anvilPort}`;
  if (!(await portFree(anvilPort))) throw new Error(`port ${anvilPort} is in use: refusing to reuse a node this run did not start`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "demo-world-"));
  const children: ChildProcess[] = [];
  const stop = () => children.forEach((p) => p.exitCode === null && p.kill("SIGTERM"));
  process.once("SIGINT", () => (stop(), process.exit(130)));
  try {
    children.push(spawn("anvil", ["--host", "127.0.0.1", "--port", String(anvilPort), "--chain-id", "31337", "--silent"], { stdio: "ignore" }));
    const chain = { ...foundry, rpcUrls: { default: { http: [rpc] } } };
    const probe = createChain97({ rpc, gasPrice: BigInt(1), chain });
    await waitFor("anvil", async () => (await probe.pub.getChainId()) === 31337, 15_000);
    const deployments = "deployments/.e2e/world";
    rmSync(path.join(CONTRACTS, deployments), { recursive: true, force: true });
    const forge = spawnSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"], {
      cwd: CONTRACTS,
      env: { ...process.env, DEPLOYMENTS_DIR: deployments, PRIVATE_KEY: ANVIL_0, ALLOW_NON_LOCAL_BROADCAST: "false" },
      encoding: "utf8",
    });
    if (forge.status !== 0) throw new Error(`forge deploy failed:\n${(forge.stdout + forge.stderr).split("\n").slice(-20).join("\n")}`);
    const d = JSON.parse(readFileSync(path.join(CONTRACTS, deployments, "31337.json"), "utf8")) as Deployment;

    let server = (process.env.WORLD_SERVER_URL ?? "").replace(/\/+$/, "");
    if (!server) {
      if (!existsSync(path.join(WEB, ".next/BUILD_ID"))) throw new Error("no web/.next build: run `pnpm -C web build` first (or set WORLD_SERVER_URL)");
      if (!(await portFree(webPort))) throw new Error(`port ${webPort} is in use`);
      server = `http://127.0.0.1:${webPort}`;
      // Hermetic: mock AI, local memory, temp storage; every sponsor key blanked so a local .env cannot make a paid call.
      const env = {
        ...process.env,
        KEYESCROW_E2E: "1",
        KEYESCROW_CHAIN_ID: "31337",
        KEYESCROW_RPC_URL_31337: rpc,
        VISION_LLM_PROVIDER: "mock",
        ANTHROPIC_API_KEY: "",
        LIVING_BRAIN_API_KEY: "",
        CMC_API_KEY: "",
        CMC_PRO_API_KEY: "",
        COURNOT_API_KEY: "",
        GREENFIELD_PRIVATE_KEY: "",
        INSPECTOR_PRIVATE_KEY: "",
        DEMO_TESTNET_RUNNER: "",
        SETTINGS_SECRETS_ENABLED: "",
        EVIDENCE_DIR: path.join(tmp, "evidence"),
        FLEET_DIR: path.join(tmp, "fleet"),
        SPONSOR_LOG_DIR: path.join(tmp, "sponsor-logs"),
      };
      const next = spawn(path.join(WEB, "node_modules/.bin/next"), ["start", "-H", "127.0.0.1", "-p", String(webPort)], { cwd: WEB, env, stdio: ["ignore", "ignore", "pipe"] });
      next.stderr!.on("data", (b) => process.env.WORLD_DEBUG && process.stderr.write(b));
      children.push(next);
      await waitFor("next start", async () => (await fetch(`${server}/api/listings`)).ok, 60_000);
    }

    const who: Record<string, PrivateKeyAccount> = {};
    for (const p of [...world.shops, ...world.renters]) who[p.id] = privateKeyToAccount(keccak256(toHex(`keyescrow demo world rehearse ${p.id} (anvil only)`)));
    if (saveAddresses(31337, who)) console.log(`updated the 31337 rehearse addresses in ${path.relative(ROOT, ADDRESSES_FILE)}`);
    const c = createChain97({ rpc, gasPrice: await gasPrice(() => probe.pub.getGasPrice()), chain });
    const file = path.join(tmp, "state.json");
    const state = loadState(undefined, 31337, d.escrowFactory);
    const ctx: Ctx = { chainId: 31337, c, d, server, funder: privateKeyToAccount(ANVIL_0), desk: privateKeyToAccount(ANVIL_3), who, state, save: () => writeFileSync(file, JSON.stringify(state)), sent: 0, counts: { ai: 0, aiLive: 0, captures: 0, evidence: 0 } };
    console.log(`rehearse: anvil ${rpc}, factory ${d.escrowFactory}, server ${server}`);
    printPlan(undefined, c.gasPrice, await c.pub.getBalance({ address: ctx.funder.address }));

    // 1. Crash half-way, right after a broadcast and before its receipt.
    ctx.crashAfter = 40;
    await runWorld(ctx).then(
      () => assert(false, "the simulated crash happened"),
      (e: Error) => {
        if (!e.message.includes("simulated crash")) throw e;
        console.log(`\n  -- ${e.message}; resuming from the state file --\n`);
      },
    );
    // 2. Resume from the file, as a fresh process would.
    const resumed: Ctx = { ...ctx, crashAfter: undefined, state: loadState(readFileSync(file, "utf8"), 31337, d.escrowFactory) };
    resumed.save = () => writeFileSync(file, JSON.stringify(resumed.state));
    await runWorld(resumed);
    // 3. A re-run sends nothing.
    const block = await c.pub.getBlockNumber();
    await runWorld(resumed);
    assert((await c.pub.getBlockNumber()) === block, "a re-run of a finished world sends no transaction");
    await checks(resumed);
    summary(resumed);
    console.log(`\nrehearse PASS: ${asserts} assertions`);
    if (process.env.WORLD_KEEP) {
      // Look around: anvil + server stay up until Ctrl-C (run with WORLD_ANVIL_PORT=8545 for the web build's default RPC).
      console.log(`WORLD_KEEP: ${server}/backoffice is up until Ctrl-C`);
      await new Promise<void>((resolve) => process.once("SIGTERM", resolve));
    }
  } finally {
    stop();
    rmSync(tmp, { recursive: true, force: true });
  }
}

let asserts = 0;
function assert(cond: unknown, msg: string): asserts cond {
  asserts++;
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function checks(ctx: Ctx) {
  const pub = ctx.c.pub;
  assert(remaining(plan, ctx.state).length === 0, "every step is done");
  const expected = { clean: Status.Settled, damage: Status.Settled, dispute: Status.Settled, "open-dispute": Status.Disputed, active: Status.Active, offer: Status.Created };
  for (const r of world.rentals) {
    const escrow = escrowOf(ctx, r.id);
    const status = Number(await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "status" }));
    assert(status === expected[r.outcome], `${r.id} (${r.outcome}) status ${status}`);
    const { rent, deposit } = amounts(r, catalogue, THB_PER_USDT);
    const held = (await pub.readContract({ address: ctx.d.token, abi: tokenAbi, functionName: "balanceOf", args: [escrow] })) as bigint;
    const terms = (await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "terms" })) as { tenant: Address; landlord: Address; rentPeriod: number };
    assert(terms.tenant === addr(ctx, r.renter) && terms.landlord === addr(ctx, r.shop), `${r.id} parties`);
    assert(terms.rentPeriod === r.periodDays * 86_400, `${r.id} rent period`);
    if (settles(r.outcome)) {
      assert(held === BigInt(0), `${r.id} escrow is empty after settling`);
      const [ev] = (await pub.getContractEvents({ address: escrow, abi: escrowAbi, eventName: "Settled", fromBlock: BigInt(0) })) as unknown as { args: { tenantRefund: bigint } }[];
      const want = r.outcome === "dispute" ? disputeSplit(r, deposit).rulingRefund : BigInt(result<{ tenantRefund: string }>(ctx, `${r.id}:ai`).tenantRefund);
      assert(ev.args.tenantRefund === want, `${r.id} renter got ${fmtUsdt(ev.args.tenantRefund)}, expected ${fmtUsdt(want)}`);
      const mem = result<{ stored: number }>(ctx, `${r.id}:history`);
      assert(mem.stored === 2, `${r.id}: one memory capture per party`);
    }
    if (r.outcome === "active") assert(held === deposit + rent * BigInt(r.prepay ?? 0), `${r.id} escrow holds the deposit + prepaid rent after the first release`);
    if (r.outcome === "open-dispute") assert(held === deposit + rent, `${r.id} open dispute holds deposit + first period`);
    if (r.outcome !== "offer") {
      const evs = (await pub.getContractEvents({ address: escrow, abi: escrowAbi, eventName: "EvidenceAdded", fromBlock: BigInt(0) })) as unknown[];
      assert(evs.length === (r.outcome === "active" ? PHOTOS : 2 * PHOTOS), `${r.id} evidence anchored on-chain`);
    }
  }
  const vaultPaid = world.rentals.filter((r) => shopOf(r.shop).vault && r.outcome !== "offer");
  for (const r of vaultPaid) assert((await pub.readContract({ address: escrowOf(ctx, r.id), abi: escrowAbi, functionName: "payee" })) === ctx.d.fleetVault, `${r.id} pays the Fleet Vault`);
  assert(ctx.counts.ai === cost(plan).aiCalls, "one AI inspection per returned rental");
  // The dispute desk's view of a renter: facts from the chain index, memory from the server's local stand-in.
  const lucas = addr(ctx, "lucas");
  const { body: h } = await api<{ facts: { asRenter: { rentals: number; disputes: number } }; memory: { entries: unknown[] } }>(ctx, `/api/v1/wallet_history?chainId=31337&wallet=${lucas}`);
  assert(h.facts.asRenter.rentals === 2 && h.facts.asRenter.disputes === 1, `lucas: 2 rentals, 1 dispute (got ${JSON.stringify(h.facts?.asRenter)})`);
  assert(h.memory.entries.length === 2, "lucas: two memory entries");
  const { body: fleet } = await api<{ scooters: { owner: string; rentals: string[] }[] }>(ctx, "/api/fleet?chainId=31337");
  assert(fleet.scooters.filter((s) => s.owner === addr(ctx, "hkt")).reduce((n, s) => n + s.rentals.length, 0) === world.rentals.filter((r) => r.shop === "hkt").length, "hkt's scooters link its rentals");
}

async function main() {
  const mode = process.argv[2];
  if (mode === "plan") return cmdPlan();
  if (mode === "run") return cmdRun();
  if (mode === "rehearse") return cmdRehearse();
  throw new Error("usage: pnpm testnet:world plan | rehearse | run");
}

main().catch((e) => {
  console.error(`testnet:world: ${e instanceof Error ? e.message.split("\n").slice(0, 3).join("\n") : e}`);
  process.exitCode = 1;
});
