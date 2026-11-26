/**
 * The demo world (web/data/demo-world.json): 3 fictional shops and 10 fictional renters on BSC testnet. Pure logic for
 * `pnpm testnet:world` (web/scripts/testnet-world.mts): the ordered plan of steps, its cost, the budget guard and the
 * resumable state. No I/O and no `@/` alias, so Node can run it with type stripping and vitest can test it.
 */

export type Outcome = "clean" | "damage" | "dispute" | "open-dispute" | "active" | "offer";
export type Damage = "mirror" | "scratch" | "crack";

export type Shop = { id: string; name: string; city: string; persona: string; listings: string[]; vault?: boolean };
export type Renter = { id: string; name: string; flag: string; persona: string };
export type WorldRental = {
  id: string;
  shop: string;
  listing: string;
  renter: string;
  periodDays: 7 | 14 | 30;
  termPeriods: number;
  outcome: Outcome;
  damage?: Damage;
  prepay?: number;
  /** Disputes: the owner's claim, % of the deposit. */
  ownerClaimPct?: number;
  /** Resolved disputes: the desk gives the owner this % of the owner's claim, the rest goes back to the renter. */
  ruling?: { ownerSharePct: number; reason: string };
};
export type World = { shops: Shop[]; renters: Renter[]; rentals: WorldRental[] };
/** Wallet per persona per chain (web/data/demo-world-addresses.json, written by the script). */
export type Addresses = Record<string, Record<string, string>>;
export type CatalogueListing = { slug: string; name: string; location: string; monthThb?: number; depositThb: number; photos: string[] };

/** Photos per set (pickup, return), each anchored on-chain with addEvidence. */
export const PHOTOS = 2;
/** Day of the open dispute's arbiter window: long enough to stay open for the live demo. */
export const OPEN_DISPUTE_WINDOW_DAYS = 60;

export type TxKind =
  | "transfer"
  | "faucet"
  | "createLease"
  | "approve"
  | "fund"
  | "payRent"
  | "addEvidence"
  | "releaseRent"
  | "propose"
  | "accept"
  | "dispute"
  | "resolve";
export type OffKind = "fleet" | "link" | "photos" | "ai" | "history";

/**
 * Gas per transaction, measured by `pnpm testnet:world rehearse` on anvil (the rehearse prints any step that used more)
 * plus ~15% headroom. BSC testnet runs the same EVM, so the numbers carry over.
 */
export const GAS: Record<TxKind, bigint> = {
  transfer: BigInt(21_000),
  faucet: BigInt(75_000),
  createLease: BigInt(620_000),
  approve: BigInt(55_000),
  fund: BigInt(160_000),
  payRent: BigInt(75_000),
  addEvidence: BigInt(60_000),
  releaseRent: BigInt(110_000),
  propose: BigInt(150_000),
  accept: BigInt(185_000),
  dispute: BigInt(65_000),
  resolve: BigInt(170_000),
};

/** Who acts: a persona id (shop or renter), or the funder (deployer; on testnet it is also the dispute desk). */
export type Step =
  | { key: string; tx: TxKind; actor: string; rental?: string; set?: "pickup" | "return"; index?: number; to?: string }
  | { key: string; off: OffKind; rental?: string; shop?: string; listing?: string; set?: "pickup" | "return" };

export const FUNDER = "funder";
const returned = (o: Outcome) => o === "clean" || o === "damage" || o === "dispute" || o === "open-dispute";
export const settles = (o: Outcome) => o === "clean" || o === "damage" || o === "dispute";

/** Checks the world file against the catalogue: unknown ids, prices, outcomes the plan cannot run. */
export function validateWorld(w: World, catalogue: CatalogueListing[]) {
  const ids = new Set<string>();
  for (const p of [...w.shops, ...w.renters]) {
    if (ids.has(p.id) || p.id === FUNDER) throw new Error(`duplicate persona id ${p.id}`);
    ids.add(p.id);
  }
  for (const s of w.shops) for (const l of s.listings) if (!catalogue.some((c) => c.slug === l && c.monthThb)) throw new Error(`${s.id}: ${l} is not a catalogue listing with a monthly price`);
  const seen = new Set<string>();
  for (const r of w.rentals) {
    if (seen.has(r.id)) throw new Error(`duplicate rental ${r.id}`);
    seen.add(r.id);
    const shop = w.shops.find((s) => s.id === r.shop);
    if (!shop?.listings.includes(r.listing)) throw new Error(`${r.id}: ${r.listing} is not a listing of ${r.shop}`);
    if (!w.renters.some((x) => x.id === r.renter)) throw new Error(`${r.id}: unknown renter ${r.renter}`);
    if (![7, 14, 30].includes(r.periodDays)) throw new Error(`${r.id}: rent period must be 7, 14 or 30 days`);
    if (r.termPeriods < 1 + (r.prepay ?? 0) || r.termPeriods > 60) throw new Error(`${r.id}: term too short for the prepaid periods`);
    if ((r.outcome === "dispute" || r.outcome === "open-dispute") && !(r.ownerClaimPct! > 0 && r.ownerClaimPct! <= 100)) throw new Error(`${r.id}: a dispute needs ownerClaimPct 1-100`);
    if (r.outcome === "dispute" && !(r.ruling && r.ruling.ownerSharePct >= 0 && r.ruling.ownerSharePct <= 100 && r.ruling.reason)) throw new Error(`${r.id}: a resolved dispute needs a ruling`);
  }
}

/** THB -> token base units (6 decimals) at `thbPerUsdt`, rounded down to whole cents. */
export function thbToUnits(thb: number, thbPerUsdt: number, decimals = 6): bigint {
  const cents = BigInt(Math.floor((thb * 100) / thbPerUsdt + 1e-9));
  return cents * BigInt(10) ** BigInt(decimals - 2);
}

/** A rental's amounts from the catalogue: rent per period = monthly x days / 30 (lib/rentals rentPerPeriod). */
export function amounts(r: WorldRental, catalogue: CatalogueListing[], thbPerUsdt: number) {
  const l = catalogue.find((c) => c.slug === r.listing)!;
  const rent = thbToUnits((l.monthThb! * r.periodDays) / 30, thbPerUsdt);
  const deposit = thbToUnits(l.depositThb, thbPerUsdt);
  return { rent, deposit, funded: r.outcome === "offer" ? BigInt(0) : deposit + rent * BigInt(1 + (r.prepay ?? 0)) };
}

/** The owner's claim of a dispute and the desk's refund to the renter (base units). */
export function disputeSplit(r: WorldRental, deposit: bigint) {
  const claim = (deposit * BigInt(r.ownerClaimPct ?? 0)) / BigInt(100);
  const toOwner = r.ruling ? (claim * BigInt(r.ruling.ownerSharePct)) / BigInt(100) : BigInt(0);
  return { claim, ownerProposalRefund: deposit - claim, rulingRefund: deposit - toOwner };
}

/** Every step of the world, in order. Keys are stable: the state file marks them done. */
export function buildPlan(w: World): Step[] {
  const steps: Step[] = [];
  for (const s of w.shops) for (const l of s.listings) steps.push({ key: `fleet:${s.id}:${l}`, off: "fleet", shop: s.id, listing: l });
  for (const p of [...w.shops, ...w.renters]) steps.push({ key: `gas:${p.id}`, tx: "transfer", actor: FUNDER, to: p.id });
  for (const p of w.renters) if (w.rentals.some((r) => r.renter === p.id && r.outcome !== "offer")) steps.push({ key: `usdt:${p.id}`, tx: "faucet", actor: FUNDER, to: p.id });
  for (const r of w.rentals) {
    const k = (s: string) => `${r.id}:${s}`;
    steps.push({ key: k("create"), tx: "createLease", actor: r.shop, rental: r.id }, { key: k("link"), off: "link", rental: r.id });
    if (r.outcome === "offer") continue;
    steps.push({ key: k("approve"), tx: "approve", actor: r.renter, rental: r.id }, { key: k("fund"), tx: "fund", actor: r.renter, rental: r.id });
    if (r.prepay) steps.push({ key: k("prepay"), tx: "payRent", actor: r.renter, rental: r.id });
    for (const set of ["pickup", "return"] as const) {
      if (set === "return" && !returned(r.outcome)) break;
      steps.push({ key: k(`photos:${set}`), off: "photos", rental: r.id, set });
      for (let i = 0; i < PHOTOS; i++) steps.push({ key: k(`evidence:${set}:${i}`), tx: "addEvidence", actor: r.renter, rental: r.id, set, index: i });
    }
    if (r.outcome === "active") {
      steps.push({ key: k("release"), tx: "releaseRent", actor: r.shop, rental: r.id });
      continue;
    }
    steps.push({ key: k("ai"), off: "ai", rental: r.id });
    if (r.outcome === "clean" || r.outcome === "damage") {
      steps.push({ key: k("propose"), tx: "propose", actor: r.renter, rental: r.id }, { key: k("accept"), tx: "accept", actor: r.shop, rental: r.id });
    } else {
      steps.push({ key: k("propose"), tx: "propose", actor: r.shop, rental: r.id }, { key: k("dispute"), tx: "dispute", actor: r.renter, rental: r.id });
      if (r.outcome === "dispute") steps.push({ key: k("resolve"), tx: "resolve", actor: FUNDER, rental: r.id });
    }
    if (settles(r.outcome)) steps.push({ key: k("history"), off: "history", rental: r.id });
  }
  return steps;
}

// ---------------------------------------------------------------------------------------------------------
// State (.orca/demo-world-state.json): which steps are done, and what they produced
// ---------------------------------------------------------------------------------------------------------

export type StepState = { done?: boolean; pending?: string; result?: Record<string, unknown> };
export type WorldState = { version: 1; chainId: number; factory: string; steps: Record<string, StepState> };

export const newState = (chainId: number, factory: string): WorldState => ({ version: 1, chainId, factory: factory.toLowerCase(), steps: {} });

/** A saved state, refused when it belongs to another chain or factory (a redeploy starts a new world). */
export function loadState(text: string | undefined, chainId: number, factory: string): WorldState {
  if (!text) return newState(chainId, factory);
  const s = JSON.parse(text) as WorldState;
  if (s.version !== 1 || s.chainId !== chainId || s.factory !== factory.toLowerCase()) {
    throw new Error(`state file is for chain ${s.chainId} factory ${s.factory}, not ${chainId} ${factory.toLowerCase()}: move it away to start a new world`);
  }
  return s;
}

export const remaining = (plan: Step[], state: WorldState) => plan.filter((s) => !state.steps[s.key]?.done);

// ---------------------------------------------------------------------------------------------------------
// Cost and budget
// ---------------------------------------------------------------------------------------------------------

/** Margin on each wallet's gas money (receipts can differ from the table a little). */
export const GAS_MARGIN_PCT = BigInt(150);
/** tBNB the funder must keep after the run. */
export const RESERVE_WEI = BigInt(20_000_000_000_000_000); // 0.02

export type Cost = {
  txs: number;
  gas: bigint;
  /** Gas of each persona's own transactions (the funder tops their wallets up with it, plus the margin). */
  gasBy: Record<string, bigint>;
  aiCalls: number;
  historyCalls: number;
  /** Upper bound: one scooter-memory capture per AI inspection, one capture per party per settled rental. */
  livingBrainWrites: number;
  evidenceUploads: number;
};

export function cost(steps: Step[]): Cost {
  const c: Cost = { txs: 0, gas: BigInt(0), gasBy: {}, aiCalls: 0, historyCalls: 0, livingBrainWrites: 0, evidenceUploads: 0 };
  for (const s of steps) {
    if ("tx" in s) {
      c.txs++;
      c.gas += GAS[s.tx];
      c.gasBy[s.actor] = (c.gasBy[s.actor] ?? BigInt(0)) + GAS[s.tx];
    } else if (s.off === "ai") {
      c.aiCalls++;
      c.livingBrainWrites++;
    } else if (s.off === "history") {
      c.historyCalls++;
      c.livingBrainWrites += 2;
    } else if (s.off === "photos") c.evidenceUploads += PHOTOS;
  }
  return c;
}

/** The gas money a persona's wallet should hold for its remaining transactions. */
export const walletTarget = (gas: bigint, gasPrice: bigint) => (gas * gasPrice * GAS_MARGIN_PCT) / BigInt(100);

/**
 * tBNB the funder spends on the remaining steps: its own transactions plus each wallet's top-up (target minus what the
 * wallet already holds). Refused when it would leave less than RESERVE_WEI.
 */
export function budget(c: Cost, gasPrice: bigint, funderBalance: bigint, walletBalances: Record<string, bigint>) {
  let topUps = BigInt(0);
  for (const [who, gas] of Object.entries(c.gasBy)) {
    if (who === FUNDER) continue;
    const short = walletTarget(gas, gasPrice) - (walletBalances[who] ?? BigInt(0));
    if (short > BigInt(0)) topUps += short;
  }
  const own = (c.gasBy[FUNDER] ?? BigInt(0)) * gasPrice;
  const need = topUps + own;
  return { need, topUps, own, ok: need <= funderBalance - RESERVE_WEI, left: funderBalance - need };
}

// ---------------------------------------------------------------------------------------------------------
// Personas for the app (demo persona badge)
// ---------------------------------------------------------------------------------------------------------

export type Persona = { id: string; name: string; kind: "shop" | "renter"; flag?: string; persona: string };

/** The demo persona behind `address` on `chainId`, if it is one of the world's wallets. */
export function personaOf(w: Pick<World, "shops" | "renters">, addresses: Addresses, chainId: number, address: string | undefined): Persona | undefined {
  if (!address) return undefined;
  const a = address.toLowerCase();
  const id = Object.entries(addresses[String(chainId)] ?? {}).find(([, v]) => v.toLowerCase() === a)?.[0];
  const shop = w.shops.find((s) => s.id === id);
  if (shop) return { id: shop.id, name: shop.name, kind: "shop", persona: shop.persona };
  const r = w.renters.find((x) => x.id === id);
  return r && { id: r.id, name: r.name, kind: "renter", flag: r.flag, persona: r.persona };
}
