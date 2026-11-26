import { getAddress, http, parseEventLogs, parseGwei, type Address, type Hash } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { actionContext, rpcUrl } from "@/lib/actions/context";
import { readLease } from "@/lib/actions/lease";
import { escrowFactoryAbi, getDeployment, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { hashText } from "@/lib/hash";
import { getListing, LISTING_THB_PER_USDT, type Listing } from "@/lib/listings";
import { isFinal, replaceable, same, type StageRental, type StageStatus } from "@/lib/stage";
import { createChain97, gasPriceFrom, type Chain97 } from "../chain97.mts";
import { demoTestnetConfig } from "../demoTestnet/guards";
import { loadDemoSecrets } from "../demoTestnet/keys";
import type { Env } from "../env";
import { getSharedState, hitRateLimit, update, type SharedState } from "../state";
import {
  dripDecision,
  dripPlan,
  MAX_GAS_PER_TX,
  presenterAllowed,
  StageError,
  stageConfig,
  thbToUnits,
  type DripRecord,
  type StageConfig,
} from "./guards";

/**
 * The live stage demo's server side: a judge's phone (/r/<slug>) gets test money, the demo owner offers them the
 * rental, and the presenter (/stage/<slug>) accepts the split. The server signs only as the demo owner and the funder;
 * the judge signs fund, photos and the proposal with their own (guest or real) wallet.
 *
 * Wallets: on BSC testnet (97) the live /demo's wallets (landlord = owner, arbiter = dispute desk, funder) from
 * DEMO_TESTNET_* (demoTestnet/keys.ts); on the local anvil (31337) its public dev keys. Keys never leave the server.
 * State (the current rental per listing, drip claims, rate limits) lives in SharedState: the Durable Object on Workers.
 * The chain stays the source of truth: the record only says which escrow is the listing's current rental.
 */

// LOCAL ONLY: anvil's well-known public dev keys (#0 deployer, #1 landlord, #3 dispute desk), used on chain 31337 only.
const ANVIL = {
  funder: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  owner: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  arbiter: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;

type Loaded = {
  cfg: StageConfig;
  c: Chain97;
  rpc: string;
  owner: PrivateKeyAccount;
  arbiter: Address;
  funder?: { address: Address; account(): Promise<PrivateKeyAccount> };
  factory: Address;
  token: Address;
};

type Record_ = { rental?: StageRental; creating?: { renter: Address; at: number } };
const recordKey = (chainId: number, slug: string) => `stage:${chainId}:${slug}`;
const dripKey = (chainId: number, a: Address) => `stage:drip:${chainId}:${a.toLowerCase()}`;
const WEEK_MS = 7 * 86_400_000;
const CREATING_MS = 90_000;

const G = Symbol.for("keyescrow.stage");
type Holder = { [G]?: { sig: string; loaded?: Promise<Loaded>; queue: Promise<unknown> } };

function holder(cfg: StageConfig) {
  const g = globalThis as Holder;
  const sig = JSON.stringify(cfg);
  if (g[G]?.sig !== sig) g[G] = { sig, queue: Promise.resolve() };
  return g[G]!;
}

/** Every server-signed send goes through one queue per process, so the owner and funder never race for a nonce. */
function serial<T>(cfg: StageConfig, fn: () => Promise<T>): Promise<T> {
  const h = holder(cfg);
  const next = h.queue.then(fn, fn);
  h.queue = next.catch(() => undefined);
  return next;
}

async function load(cfg: StageConfig, env: Env): Promise<Loaded> {
  const h = holder(cfg);
  h.loaded ??= (async () => {
    const d = getDeployment(cfg.chainId);
    if (!d) throw new StageError(503, "KeyEscrow is not deployed on this chain.");
    let rpc: string, owner: PrivateKeyAccount, arbiter: Address, funder: Loaded["funder"];
    if (cfg.chainId === 31337) {
      rpc = rpcUrl(31337, env);
      owner = privateKeyToAccount(ANVIL.owner);
      arbiter = privateKeyToAccount(ANVIL.arbiter).address;
      const f = privateKeyToAccount(ANVIL.funder);
      funder = { address: f.address, account: async () => f };
    } else {
      const dcfg = demoTestnetConfig(env);
      if (!dcfg) throw new StageError(503, "The stage demo on BSC testnet needs the live demo wallets (DEMO_TESTNET_RUNNER and its keys).");
      const s = await loadDemoSecrets(env, dcfg);
      rpc = s.rpc;
      owner = s.wallets.landlord;
      arbiter = s.wallets.arbiter.address;
      funder = s.funder;
    }
    const chain = cfg.chainId === 31337 ? foundry : undefined;
    const c = createChain97({ rpc, chain, gasPrice: cfg.chainId === 31337 ? parseGwei("2") : gasPriceFrom(env.TESTNET_GAS_PRICE_GWEI), receiptTimeoutMs: 45_000 });
    // Never sign for a chain the RPC does not answer.
    const id = await c.pub.getChainId();
    if (id !== cfg.chainId) throw new StageError(503, `The stage RPC answers chain ${id}, not ${cfg.chainId}. Refusing to sign.`);
    return { cfg, c, rpc, owner, arbiter, funder, factory: d.escrowFactory, token: d.mockUsdt };
  })();
  h.loaded.catch(() => (h.loaded = undefined)); // a failed load (RPC down) is retried on the next request
  return h.loaded;
}

export type StageService = ReturnType<typeof stageService>;

/** The stage service, or undefined when the stage demo is off (STAGE_DEMO unset, another chain): routes answer 404. */
export function getStage(env: Env = process.env, state: () => SharedState = getSharedState) {
  const cfg = stageConfig(env);
  return cfg ? stageService(cfg, env, state) : undefined;
}

function stageService(cfg: StageConfig, env: Env, state: () => SharedState) {
  const listingOr404 = (slug: string): Listing => {
    const l = getListing(slug);
    if (!l) throw new StageError(404, "There is no such item.");
    return l;
  };
  const readRecord = async (slug: string) => (await state().get<Record_>(recordKey(cfg.chainId, slug)))?.value ?? {};
  // One batched JSON-RPC request per poll instead of ~16 (both screens poll every 2 s).
  const ctx = () => actionContext({ env, transport: (id) => http(rpcUrl(id, env), { batch: true, timeout: 10_000, retryCount: 1 }) }, cfg.chainId);

  // The Worker has no room for the price service in this route's chunks (see demoTestnet/http.ts): a fixed demo rate.
  async function price(listing: Listing) {
    const thbPerUsdt = LISTING_THB_PER_USDT;
    // A listing with a monthly price (the demo scooters) is rented by the month: the escrow's rent period is 30 days, so
    // its rent is that month's price and the one-time fee is 10% of it. The stage item only has its price per day.
    return { rent: thbToUnits(listing.monthThb ?? listing.rentThb, thbPerUsdt), deposit: thbToUnits(listing.depositThb, thbPerUsdt), thbPerUsdt };
  }

  async function send(l: Loaded, who: PrivateKeyAccount, call: Parameters<Chain97["sendCall"]>[1]) {
    const { hash } = await l.c.sendCall(who, call, { maxGas: MAX_GAS_PER_TX });
    const r = await l.c.wait(hash);
    if (r.status !== "success") throw new StageError(502, "The transaction was reverted on-chain. Try again.");
    return r;
  }

  return {
    cfg,

    async status(slug: string, renter?: Address): Promise<StageStatus> {
      const listing = listingOr404(slug);
      const l = await load(cfg, env);
      const c = ctx();
      const rec = await readRecord(slug);
      const lease = rec.rental?.lease;
      const [snap, p, me, drip] = await Promise.all([
        lease ? readLease(c, lease) : undefined,
        price(listing),
        renter
          ? Promise.all([
              c.client.getBalance({ address: renter }),
              c.client.readContract({ address: l.token, abi: mockUsdtAbi, functionName: "balanceOf", args: [renter] }),
            ]).then(([bnb, musdt]) => ({ address: renter, bnb, musdt }))
          : undefined,
        renter ? state().get<DripRecord>(dripKey(cfg.chainId, renter)) : undefined,
      ]);
      return {
        chainId: cfg.chainId,
        listing,
        owner: l.owner.address,
        price: p,
        rental: rec.rental,
        creating: rec.creating && Date.now() - rec.creating.at < CREATING_MS ? rec.creating : undefined,
        lease: snap,
        events: [], // filled in by the browser from /api/chain/index (components/stage/client.ts)
        drip: drip?.value.state === "done" ? { txs: drip.value.txs, at: drip.value.at } : undefined,
        me,
        presenterLocked: !!cfg.presenterCode,
      };
    },

    /**
     * Test money for a phone: tBNB for gas and mUSDT for rent + deposit, once per address (a repeat returns the first
     * answer), at most `dripsPerHour` phones an hour, never draining the funder.
     */
    async drip(slug: string, to: Address) {
      const listing = listingOr404(slug);
      const l = await load(cfg, env);
      if (!l.funder) throw new StageError(503, "No test-money wallet is configured on this server.");
      const key = dripKey(cfg.chainId, to);
      const now = Date.now();
      const claim = await update<DripRecord, "claim" | "done" | "pending">(state(), key, (cur) => {
        const d = dripDecision(cur, now);
        return d === "claim" ? { value: { state: "pending", at: now }, ttlMs: WEEK_MS, result: d } : { result: d };
      });
      if (claim === "done") return { txs: ((await state().get<DripRecord>(key))?.value as { txs: string[] }).txs, repeat: true };
      if (claim === "pending") throw new StageError(409, "Your test money is already on its way. One moment.", 5);
      try {
        const rate = await hitRateLimit(state(), `stage-drip:${cfg.chainId}`, { limit: cfg.dripsPerHour, windowMs: 3_600_000 });
        if (!rate.ok) throw new StageError(429, `Enough test money handed out for this hour. Try again in ${Math.ceil(rate.retryAfterSec / 60)} min.`, rate.retryAfterSec);
        const p = await price(listing);
        const txs = await serial(cfg, async () => {
          const funder = await l.funder!.account();
          const [bnb, musdt, funderBnb] = await Promise.all([
            l.c.pub.getBalance({ address: to }),
            l.c.pub.readContract({ address: l.token, abi: mockUsdtAbi, functionName: "balanceOf", args: [to] }),
            l.c.pub.getBalance({ address: funder.address }),
          ]);
          const plan = dripPlan({ bnb, musdt, need: p.rent + p.deposit, funderBnb });
          const out: Hash[] = [];
          if (plan.bnb > BigInt(0)) {
            const h = await l.c.sendValue(funder, to, plan.bnb);
            out.push(h);
            await l.c.wait(h);
          }
          if (plan.musdt > BigInt(0)) out.push((await send(l, funder, { address: l.token, abi: mockUsdtAbi, functionName: "faucet", args: [to, plan.musdt] })).transactionHash);
          return out;
        });
        await update<DripRecord, void>(state(), key, () => ({ value: { state: "done", at: Date.now(), txs }, ttlMs: WEEK_MS, result: undefined }));
        console.log(`[stage] drip to ${to}: ${txs.length} txs`);
        return { txs, repeat: false };
      } catch (e) {
        // Free the claim so the phone can retry.
        await update<DripRecord, void>(state(), key, (cur) => (cur?.state === "pending" ? { value: null, result: undefined } : { result: undefined }));
        throw e;
      }
    },

    /**
     * The demo owner offers `renter` this item's rental (createLease, server-signed). Idempotent: the renter's own open
     * rental is returned as is. One rental per item at a time: someone else's open rental answers 409.
     */
    async lease(slug: string, renter: Address) {
      const listing = listingOr404(slug);
      const l = await load(cfg, env);
      const c = ctx();
      const now = Date.now();
      const key = recordKey(cfg.chainId, slug);
      const cur = await readRecord(slug);
      const snap = cur.rental ? await readLease(c, cur.rental.lease) : undefined;
      if (cur.rental && snap && same(cur.rental.renter, renter) && !isFinal(snap.status)) return { lease: cur.rental.lease, repeat: true };
      if (!replaceable({ rental: cur.rental, lease: snap }, now)) throw new StageError(409, "Someone else is renting this item right now. Ask the presenter to reset the stage.");
      if (same(renter, l.owner.address) || same(renter, l.arbiter)) throw new StageError(400, "That wallet belongs to the owner or the dispute desk. Use a guest wallet.");

      // Claim the slot atomically: only one createLease in flight per item.
      const claimed = await update<Record_, boolean>(state(), key, (now_) => {
        const n = now_ ?? {};
        if (n.rental?.lease !== cur.rental?.lease) return { result: false };
        if (n.creating && now - n.creating.at < CREATING_MS) return { result: false };
        return { value: { ...n, creating: { renter, at: now } }, ttlMs: WEEK_MS, result: true };
      });
      if (!claimed) throw new StageError(409, "The owner is setting up a rental right now. One moment.", 5);
      try {
        const rate = await hitRateLimit(state(), `stage-lease:${cfg.chainId}`, { limit: cfg.leasesPerHour, windowMs: 3_600_000 });
        if (!rate.ok) throw new StageError(429, `Enough rentals for this hour. Try again in ${Math.ceil(rate.retryAfterSec / 60)} min.`, rate.retryAfterSec);
        const p = await price(listing);
        const receipt = await serial(cfg, () =>
          send(l, l.owner, {
            address: l.factory,
            abi: escrowFactoryAbi,
            functionName: "createLease",
            args: [
              {
                tenant: renter,
                arbiter: l.arbiter,
                rentAmount: p.rent,
                depositAmount: p.deposit,
                // One 30-day period: the stage rental is "one day" in the UI and settles the same day. 30 days (not 7)
                // keeps the one-time fee at 10% of the rent, so the on-stage numbers stay as rehearsed.
                termPeriods: 1,
                rentPeriod: 30 * 86_400,
                responseWindow: 0,
                arbiterWindow: 0,
                leaseHash: hashText(JSON.stringify({ listing: listing.slug, name: listing.name, rentThb: listing.rentThb, monthThb: listing.monthThb, depositThb: listing.depositThb, renter, at: now })),
              },
            ],
          }),
        );
        const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: receipt.logs.filter((g) => same(g.address, l.factory)) });
        if (!created) throw new StageError(502, "The rental was not created. Try again.");
        const rental: StageRental = { lease: getAddress((created.args as { escrow: Address }).escrow), renter, createdAt: now };
        await update<Record_, void>(state(), key, () => ({ value: { rental }, ttlMs: WEEK_MS, result: undefined }));
        console.log(`[stage] ${slug}: rental ${rental.lease} for ${renter}`);
        return { lease: rental.lease, repeat: false };
      } catch (e) {
        await update<Record_, void>(state(), key, (n) => (n?.creating && same(n.creating.renter, renter) ? { value: { rental: n.rental }, ttlMs: WEEK_MS, result: undefined } : { result: undefined }));
        throw e;
      }
    },

    /** Presenter: the owner accepts the renter's proposed split (server-signed). Idempotent once settled. */
    async accept(slug: string, code?: string) {
      listingOr404(slug);
      if (!presenterAllowed(cfg, code)) throw new StageError(403, "Wrong presenter code.");
      const l = await load(cfg, env);
      const { rental } = await readRecord(slug);
      if (!rental) throw new StageError(409, "There is no rental on stage yet.");
      const snap = await readLease(ctx(), rental.lease);
      if (snap.status === "Settled") return { hash: undefined, repeat: true };
      if (snap.status !== "MoveOut") throw new StageError(409, "There is no split to accept yet: the renter proposes it after the return photos.");
      if (!same(snap.proposal.proposer, rental.renter)) throw new StageError(409, "The latest proposal is the owner's own; the renter has to answer it.");
      const r = await serial(cfg, () => send(l, l.owner, { address: rental.lease, abi: rentalEscrowAbi, functionName: "accept", args: [snap.proposal.nonce] }));
      return { hash: r.transactionHash, repeat: false };
    },

    /** Presenter: forget the current rental so the next judge starts fresh (the old escrow stays on-chain as is). */
    async reset(slug: string, code?: string) {
      listingOr404(slug);
      if (!presenterAllowed(cfg, code)) throw new StageError(403, "Wrong presenter code.");
      await update<Record_, void>(state(), recordKey(cfg.chainId, slug), () => ({ value: null, result: undefined }));
      return { ok: true };
    },
  };
}
