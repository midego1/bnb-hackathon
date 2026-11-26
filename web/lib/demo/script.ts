import { parseEventLogs, parseUnits, zeroAddress, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { escrowFactoryAbi, EvidenceKind, fleetVaultAbi, LeaseStatus, mockUsdtAbi, rentalEscrowAbi, TOKEN, type Deployment } from "../contracts";
import type { DevRole } from "../devAccounts";
import type { UploadedFile } from "../evidence";
import { hashText } from "../hash";
import { localized, type Lang } from "../i18n/locales";
import type { InspectionPhoto, InspectionResult } from "../settlement";
import { zhPropertyName } from "./places.zh";
import { zhPaths, zhSteps, zhTxLabel } from "./script.zh";

/**
 * The guided one-click demo (/demo, local anvil only). Each step is a short, plain-English beat of the KeyEscrow
 * story that drives the real contracts through the same helpers as the normal UI (useTx, uploadEvidence,
 * runInspection). The runner (components/demo/DemoRunner.tsx) supplies `DemoApi`, switches the demo account
 * before each step and shows the caption, progress and transactions.
 */

export type DemoPath = "happy" | "dispute" | "timeout" | "fleet";
export type DemoActor = DevRole | "inspector" | "anyone";

export const PATHS: Record<DemoPath, { label: string; blurb: string }> = {
  happy: { label: "Happy path", blurb: "Renter proposes the AI split, owner accepts, money moves at once." },
  dispute: { label: "Dispute path", blurb: "Owner disputes the proposal, the KeyEscrow dispute desk rules on a split." },
  timeout: { label: "Owner ignores it", blurb: "Owner stays silent for 7 days, so the full deposit goes back to the renter." },
  fleet: { label: "Fleet Vault", blurb: "A fleet scooter: rent and the damage payout flow into the Fleet Vault, and its shareholders earn." },
};

/** Realistic monthly scooter rentals in Thailand, priced in baht; a fresh rental each run cycles through them. */
export const PROPERTIES = [
  { name: "Honda Click 125i from a shop in Chiang Mai Old City", rentThb: 3_400 },
  { name: "Honda Scoopy-i from a shop in Pai", rentThb: 3_000 },
  { name: "Yamaha NMAX 155 from a shop in Patong, Phuket", rentThb: 5_500 },
] as const;
export type Property = (typeof PROPERTIES)[number];

const TERM_MONTHS = 3;
const RESPONSE_WINDOW = 7 * 86_400;
const ARBITER_WINDOW = 14 * 86_400;
const DEPOSIT_MONTHS = BigInt(2);
const UNIT = BigInt(10) ** BigInt(TOKEN.decimals); // 1 token

const CHECK_IN = [
  { file: "checkin-left-side.png", label: "Left side" },
  { file: "checkin-front.png", label: "Front" },
];
const CHECK_OUT = [
  { file: "checkout-left-side.png", label: "Left side" },
  { file: "checkout-front.png", label: "Front" },
];

export type Photo = { hash: Hex; label: string; url: string };
/** `vault` is the Fleet Vault (0 when the deployment has none); on the Fleet Vault path it receives the owner's cut. */
export type Balances = { tenant: bigint; landlord: bigint; treasury: bigint; escrow: bigint; vault: bigint };
export type DemoTx = { label: string; hash: Hex };

/** Everything the steps learn as they go. Steps mutate it, so a retried step resumes where it failed. */
export type DemoCtx = {
  path: DemoPath;
  property: Property;
  rent: bigint;
  deposit: bigint;
  termPeriods: number;
  leaseHash?: Hex;
  checkIn?: Photo[];
  checkInAnchored: number;
  lease?: Address;
  treasury?: Address;
  feeBps?: number;
  faucet?: bigint;
  before?: Balances;
  rentToLandlord?: bigint;
  fee?: bigint;
  checkOut?: Photo[];
  checkOutAnchored: number;
  inspection?: InspectionResult;
  nonce?: number;
  ruling?: { tenantRefund: bigint; landlordClaim: bigint; text: string };
  fastForwarded?: number;
  settled?: { tenantRefund: bigint; landlordClaim: bigint; rentToLandlord: bigint; rentToTenant: bigint; fee: bigint };
  after?: Balances;
  finalStatus?: number;
  /** Fleet Vault path: vault income after the damaged return, and the demo shareholder's claimable income. */
  vaultIncome?: { before: bigint; after: bigint; claimable: bigint; symbol: string };
};

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

export type DemoApi = {
  deployment: Deployment;
  /** Who plays each role: the anvil dev accounts locally, the server's demo wallets on BSC testnet. */
  accounts: Record<DevRole, Address>;
  /** The lease's referee: address(0) = the factory's default (local); the demo dispute desk on BSC testnet. */
  leaseArbiter: Address;
  /** Switch the connected demo account (anvil dev accounts) and wait until wagmi sees it. */
  as(role: DevRole): Promise<void>;
  /** Simulate, send and confirm a contract call through the app's own useTx hook. Throws a plain-language error. */
  tx(label: string, call: Call): Promise<TransactionReceipt>;
  read<T>(call: Call): Promise<T>;
  /** Fetch a bundled demo file from /public/demo and store it through POST /api/evidence. */
  upload(files: { path: string; name: string; type: string }[]): Promise<UploadedFile[]>;
  inspect(input: { deposit: bigint; checkIn: InspectionPhoto[]; checkOut: InspectionPhoto[] }): Promise<InspectionResult>;
  /** Dev-only anvil RPC: evm_increaseTime + evm_mine. */
  fastForward(seconds: number): Promise<void>;
  /** Re-read every on-chain query on screen, so the live lease page is current. */
  refresh(): Promise<void>;
};

export type DemoStep = {
  id: string;
  title: string;
  actor: DemoActor;
  /** Shown as a badge: this step does something only a local demo chain can do. */
  demoOnly?: string;
  caption: (ctx: DemoCtx, money: (v: bigint) => string) => string;
  run: (api: DemoApi, ctx: DemoCtx) => Promise<void>;
};

export function newContext(path: DemoPath, run: number, thbPerUsdt: number | undefined): DemoCtx {
  const property = PROPERTIES[run % PROPERTIES.length];
  const rate = thbPerUsdt && thbPerUsdt > 0 ? thbPerUsdt : 33;
  const rent = parseUnits((property.rentThb / rate).toFixed(2), TOKEN.decimals);
  return { path, property, rent, deposit: rent * DEPOSIT_MONTHS, termPeriods: TERM_MONTHS, checkInAnchored: 0, checkOutAnchored: 0 };
}

const need = (ctx: DemoCtx) => ctx.deposit + ctx.rent;
const leaseOf = (ctx: DemoCtx) => {
  if (!ctx.lease) throw new Error("The demo rental has not been created yet. Start over.");
  return ctx.lease;
};

async function balances(api: DemoApi, ctx: DemoCtx): Promise<Balances> {
  const bal = (who: Address) => api.read<bigint>({ address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "balanceOf", args: [who] });
  const [tenant, landlord, treasury, escrow, vault] = await Promise.all([
    bal(api.accounts.tenant),
    bal(api.accounts.landlord),
    bal(ctx.treasury ?? zeroAddress),
    bal(leaseOf(ctx)),
    api.deployment.fleetVault ? bal(api.deployment.fleetVault) : Promise.resolve(BigInt(0)),
  ]);
  return { tenant, landlord, treasury, escrow, vault };
}

async function anchor(api: DemoApi, ctx: DemoCtx, kind: "CheckIn" | "CheckOut") {
  const photos = (kind === "CheckIn" ? ctx.checkIn : ctx.checkOut) ?? [];
  const field = kind === "CheckIn" ? "checkInAnchored" : "checkOutAnchored";
  const label = kind === "CheckIn" ? "pickup" : "return";
  for (let i = ctx[field]; i < photos.length; i++) {
    await api.tx(`Record ${label} photo ${i + 1}/${photos.length}`, {
      address: leaseOf(ctx),
      abi: rentalEscrowAbi,
      functionName: "addEvidence",
      args: [EvidenceKind[kind], photos[i].hash],
    });
    ctx[field] = i + 1;
  }
}

async function uploadPhotos(api: DemoApi, set: typeof CHECK_IN): Promise<Photo[]> {
  const paths = set.map((p) => `/demo/walkthrough/${p.file}`);
  const items = await api.upload(set.map((p, i) => ({ path: paths[i], name: p.file, type: "image/png" })));
  // The url lets the inspector fetch the static photo where the evidence store is off or forgot it (a Worker).
  return items.map((it, i) => ({ hash: it.hash, label: set[i].label, url: new URL(paths[i], location.origin).href }));
}

// ---------------------------------------------------------------------------------------------------------------
// Steps shared by every path: rental -> funding -> first rent -> return photos -> AI inspection -> proposal
// ---------------------------------------------------------------------------------------------------------------

const createLease: DemoStep = {
  id: "create",
  title: "Owner offers the rental",
  actor: "landlord",
  caption: (c, m) =>
    `${c.property.name}: ${m(c.rent)} a month, ${m(c.deposit)} deposit held in escrow instead of the renter's passport, ${c.termPeriods}-month rental period. ` +
    `The rental agreement PDF and pickup photos are stored off-chain; only their SHA-256 fingerprints go on-chain. The KeyEscrow dispute desk is the default referee.`,
  async run(api, ctx) {
    await api.as("landlord");
    if (!ctx.leaseHash || !ctx.checkIn) {
      const [pdf] = await api.upload([{ path: "/demo/lease.pdf", name: "lease.pdf", type: "application/pdf" }]);
      ctx.leaseHash = pdf.hash;
      ctx.checkIn = await uploadPhotos(api, CHECK_IN);
    }
    if (!ctx.lease) {
      const vault = api.deployment.fleetVault;
      if (ctx.path === "fleet" && !vault) throw new Error("This deployment has no Fleet Vault. Redeploy the local chain (pnpm chain:deploy).");
      const fleet = ctx.path === "fleet";
      const receipt = await api.tx(fleet ? "Create fleet rental" : "Create rental", {
        address: api.deployment.escrowFactory,
        abi: escrowFactoryAbi,
        // Fleet Vault path: same rental, but the owner's payouts (rent + any damage claim) go to the vault.
        functionName: fleet ? "createLeaseWithPayee" : "createLease",
        args: [
          {
            tenant: api.accounts.tenant,
            arbiter: api.leaseArbiter, // address(0) = the factory's default arbiter, the KeyEscrow dispute desk
            rentAmount: ctx.rent,
            depositAmount: ctx.deposit,
            termPeriods: ctx.termPeriods,
            rentPeriod: 0, // factory default: monthly (30 days)
            responseWindow: RESPONSE_WINDOW,
            arbiterWindow: ARBITER_WINDOW,
            leaseHash: ctx.leaseHash,
          },
          ...(fleet ? [vault] : []),
        ],
      });
      const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: receipt.logs });
      if (!created) throw new Error("The rental was created but its address could not be read from the receipt.");
      ctx.lease = created.args.escrow as Address;
    }
    const terms = await api.read<{ feeRecipient: Address; feeBps: number }>({ address: ctx.lease, abi: rentalEscrowAbi, functionName: "terms" });
    ctx.treasury = terms.feeRecipient;
    ctx.feeBps = Number(terms.feeBps);
  },
};

const recordCheckIn: DemoStep = {
  id: "checkin",
  title: "Pickup photos on record",
  actor: "landlord",
  caption: () =>
    "The owner anchors the fingerprint of each pickup photo on the rental contract. At return the AI inspection compares against exactly these files; nobody can swap them later.",
  async run(api, ctx) {
    await api.as("landlord");
    await anchor(api, ctx, "CheckIn");
  },
};

const getUsdt: DemoStep = {
  id: "faucet",
  title: "Renter gets demo mUSDT",
  actor: "tenant",
  caption: (c, m) =>
    c.faucet === BigInt(0)
      ? `The renter already holds enough MockUSDT (the testnet stand-in for USDT) for ${m(need(c))}, so no faucet is needed.`
      : `MockUSDT is the testnet stand-in for USDT. The renter taps its faucet for the ${m(need(c))} they need. On mainnet this would be real USDT.`,
  async run(api, ctx) {
    await api.as("tenant");
    const balance = await api.read<bigint>({ address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "balanceOf", args: [api.accounts.tenant] });
    if (balance >= need(ctx)) {
      ctx.faucet = BigInt(0);
      return;
    }
    await api.tx("Get test USDT", { address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "faucet", args: [api.accounts.tenant, need(ctx)] });
    ctx.faucet = need(ctx);
  },
};

const fund: DemoStep = {
  id: "fund",
  title: "Renter funds deposit + first month",
  actor: "tenant",
  caption: (c, m) =>
    `Two wallet steps: approve, then fund. ${m(need(c))} moves into this rental's own escrow contract, not to the owner. From here on, neither side can move the deposit alone.`,
  async run(api, ctx) {
    await api.as("tenant");
    const lease = leaseOf(ctx);
    ctx.before ??= await balances(api, ctx);
    const allowance = await api.read<bigint>({ address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "allowance", args: [api.accounts.tenant, lease] });
    if (allowance < need(ctx)) {
      await api.tx("Approve USDT", { address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "approve", args: [lease, need(ctx)] });
    }
    await api.tx("Fund escrow", { address: lease, abi: rentalEscrowAbi, functionName: "fund" });
  },
};

const payRent: DemoStep = {
  id: "rent",
  title: "Month 1 rent paid out",
  actor: "tenant",
  caption: (c, m) => {
    const fee = c.fee ?? (c.rent * BigInt(c.feeBps ?? 1000)) / BigInt(10_000);
    return (
      `Month 1 is due on day one. The renter releases it: ${m(c.rentToLandlord ?? c.rent - fee)} to the owner and the one-time KeyEscrow fee of ${m(fee)} ` +
      `(${((c.feeBps ?? 1000) / 100).toFixed(0)}% of one month's rent) to the KeyEscrow treasury. The deposit stays locked.`
    );
  },
  async run(api, ctx) {
    await api.as("tenant");
    const receipt = await api.tx("Release rent", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "releaseRent" });
    const [ev] = parseEventLogs({ abi: rentalEscrowAbi, eventName: "RentReleased", logs: receipt.logs });
    if (ev) {
      const a = ev.args as { toLandlord: bigint; fee: bigint };
      ctx.rentToLandlord = a.toLandlord;
      ctx.fee = a.fee;
    }
  },
};

const checkOut: DemoStep = {
  id: "checkout",
  title: "Return: scooter photos",
  actor: "tenant",
  caption: () =>
    "Return day. In real life two more months of rent flow the same way; the demo skips ahead. No clock is faked: settling the deposit does not depend on time. " +
    "The renter brings the scooter back and records two return photos from the same angles. The left side panel is scratched and a mirror is cracked.",
  async run(api, ctx) {
    await api.as("tenant");
    ctx.checkOut ??= await uploadPhotos(api, CHECK_OUT);
    await anchor(api, ctx, "CheckOut");
  },
};

const inspect: DemoStep = {
  id: "inspect",
  title: "AI inspection drafts a split",
  actor: "inspector",
  caption: (c, m) =>
    c.inspection
      ? `The KeyEscrow Inspector agent compared pickup and return photos: ${m(BigInt(c.inspection.tenantRefund))} back to the renter, ` +
        `${m(BigInt(c.inspection.landlordClaim))} to the owner for repairs. It drafts; it never decides. Its report hash goes on-chain with the proposal.`
      : "The KeyEscrow Inspector agent compares pickup and return photos and drafts a deposit split with reasons. It drafts; it never decides.",
  async run(api, ctx) {
    if (!ctx.checkIn || !ctx.checkOut) throw new Error("The photos are missing. Start over.");
    ctx.inspection = await api.inspect({ deposit: ctx.deposit, checkIn: ctx.checkIn, checkOut: ctx.checkOut });
  },
};

const propose: DemoStep = {
  id: "propose",
  title: "Renter proposes the split on-chain",
  actor: "tenant",
  caption: (c, m) =>
    c.inspection
      ? `The renter agrees with the AI and proposes it on-chain: ${m(BigInt(c.inspection.tenantRefund))} back, ${m(BigInt(c.inspection.landlordClaim))} to the owner. ` +
        `Now the owner has ${RESPONSE_WINDOW / 86_400} days to accept, counter or dispute.`
      : "The renter proposes the AI split on-chain.",
  async run(api, ctx) {
    await api.as("tenant");
    const r = ctx.inspection;
    if (!r) throw new Error("There is no AI proposal yet. Retry the inspection step.");
    const lease = leaseOf(ctx);
    await api.tx("Submit AI proposal", { address: lease, abi: rentalEscrowAbi, functionName: "propose", args: [BigInt(r.tenantRefund), r.reportHash] });
    const p = await api.read<{ nonce: number }>({ address: lease, abi: rentalEscrowAbi, functionName: "proposal" });
    ctx.nonce = Number(p.nonce);
  },
};

function captureSettled(ctx: DemoCtx, receipt: TransactionReceipt) {
  const [ev] = parseEventLogs({ abi: rentalEscrowAbi, eventName: "Settled", logs: receipt.logs });
  if (ev) ctx.settled = ev.args as unknown as NonNullable<DemoCtx["settled"]>;
}

// ---------------------------------------------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------------------------------------------

const accept: DemoStep = {
  id: "accept",
  title: "Owner accepts: instant settlement",
  actor: "landlord",
  caption: () => "The owner reviews the photos and the AI reasons and accepts. One transaction pays everyone out: no haggling at the counter, no passport held back, no court.",
  async run(api, ctx) {
    await api.as("landlord");
    const receipt = await api.tx("Accept proposal", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "accept", args: [ctx.nonce ?? 1] });
    captureSettled(ctx, receipt);
  },
};

const dispute: DemoStep = {
  id: "dispute",
  title: "Owner opens a dispute",
  actor: "landlord",
  caption: () =>
    `The owner thinks the repairs cost more than the AI says and opens a dispute instead. Now only the KeyEscrow dispute desk can split the deposit, ` +
    `within ${ARBITER_WINDOW / 86_400} days; if it misses that deadline, the full deposit goes back to the renter.`,
  async run(api, ctx) {
    await api.as("landlord");
    await api.tx("Open dispute", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "dispute" });
  },
};

/** The desk's ruling for the scripted dispute: half again the AI's repair estimate, in whole tokens. */
export function deskRuling(ctx: DemoCtx) {
  const ai = ctx.inspection ? BigInt(ctx.inspection.landlordClaim) : ctx.deposit / BigInt(5);
  let landlordClaim = ((ai * BigInt(3)) / BigInt(2) / UNIT) * UNIT;
  if (landlordClaim > ctx.deposit) landlordClaim = ctx.deposit;
  return { landlordClaim, tenantRefund: ctx.deposit - landlordClaim };
}

const resolve: DemoStep = {
  id: "resolve",
  title: "Dispute desk rules on a split",
  actor: "arbiter",
  caption: (c, m) => {
    const r = c.ruling ?? deskRuling(c);
    return (
      `The dispute desk reviews the same photos and the AI report and rules: the owner keeps ${m(r.landlordClaim)} for the panel respray and a new mirror, ` +
      `${m(r.tenantRefund)} goes back to the renter. The ruling's fingerprint is stored on-chain with the payout.`
    );
  },
  async run(api, ctx) {
    await api.as("arbiter");
    const r = deskRuling(ctx);
    const text = `Ruling for rental ${ctx.lease}: the shop's repair quote for the side panel and mirror is above the AI estimate. Owner keeps ${r.landlordClaim} base units, renter gets ${r.tenantRefund} back.`;
    ctx.ruling = { ...r, text };
    const receipt = await api.tx("Resolve dispute", {
      address: leaseOf(ctx),
      abi: rentalEscrowAbi,
      functionName: "resolve",
      args: [r.tenantRefund, hashText(JSON.stringify({ tenantRefund: r.tenantRefund.toString(), ruling: text }))],
    });
    captureSettled(ctx, receipt);
  },
};

const wait: DemoStep = {
  id: "wait",
  title: "Owner stays silent for 7 days",
  actor: "anyone",
  demoOnly: `fast-forward ${RESPONSE_WINDOW / 86_400} days (demo only)`,
  caption: () =>
    `The owner does not answer. On a real chain we would wait ${RESPONSE_WINDOW / 86_400} days; on this local demo chain we fast-forward the block clock ` +
    "(anvil's evm_increaseTime). This is the only place the demo bends time, and it is impossible on a real network.",
  async run(api, ctx) {
    if (!ctx.fastForwarded) {
      await api.fastForward(RESPONSE_WINDOW + 60);
      ctx.fastForwarded = RESPONSE_WINDOW + 60;
    }
  },
};

const claimTimeout: DemoStep = {
  id: "timeout",
  title: "Full deposit back to the renter",
  actor: "tenant",
  caption: (c, m) =>
    `The owner's reply window has passed, so anyone can close the rental. The owner never backed a claim, so the full ${m(c.deposit)} deposit goes back to the renter, ` +
    "not just the AI split. Silence can never cost the renter money.",
  async run(api, ctx) {
    await api.as("tenant");
    const receipt = await api.tx("Claim owner timeout", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "claimTimeout" });
    captureSettled(ctx, receipt);
  },
};

const final: DemoStep = {
  id: "final",
  title: "Final balances",
  actor: "anyone",
  caption: () => "The escrow is empty and every baht is accounted for: what the renter paid in went to the owner, the KeyEscrow treasury, or back to the renter.",
  async run(api, ctx) {
    ctx.after = await balances(api, ctx);
    ctx.finalStatus = Number(await api.read<number>({ address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "status" }));
    if (ctx.finalStatus !== LeaseStatus.Settled) throw new Error("The rental did not end up settled. Open the rental page to see why.");
    await api.refresh();
  },
};

const vaultIncome: DemoStep = {
  id: "vault",
  title: "Fleet Vault balance goes up",
  actor: "investor",
  caption: (c, m) => {
    const v = c.vaultIncome;
    return v
      ? `This scooter belongs to the Fleet Vault. Its rent and the ${m(c.settled?.landlordClaim ?? BigInt(0))} damage payout from the slashed deposit went straight into the vault: ` +
          `its unshared income rose from ${m(v.before)} to ${m(v.after)}. After the operator's maintenance fee, ${v.symbol} shareholders split it; the demo shareholder can now claim ${m(v.claimable)}.`
      : "This scooter belongs to the Fleet Vault: its rent and the damage payout go into the vault, and the shareholders claim their part.";
  },
  async run(api, ctx) {
    const vault = api.deployment.fleetVault;
    if (!vault) throw new Error("This deployment has no Fleet Vault.");
    const read = <T,>(functionName: string, args: unknown[] = []) => api.read<T>({ address: vault, abi: fleetVaultAbi as Abi, functionName, args });
    const [after, claimable, symbol] = await Promise.all([read<bigint>("unsyncedIncome"), read<bigint>("claimable", [api.accounts.investor]), read<string>("symbol")]);
    // Everything this rental paid into the vault since funding (rent + damage payout).
    const paid = ctx.before ? (await balances(api, ctx)).vault - ctx.before.vault : BigInt(0);
    const before = after - paid;
    ctx.vaultIncome = { before: before < BigInt(0) ? BigInt(0) : before, after, claimable, symbol };
  },
};

const prefix = [createLease, recordCheckIn, getUsdt, fund, payRent, checkOut, inspect, propose];

function pathSteps(path: DemoPath): DemoStep[] {
  if (path === "dispute") return [...prefix, dispute, resolve, final];
  if (path === "timeout") return [...prefix, wait, claimTimeout, final];
  if (path === "fleet") return [...prefix, accept, vaultIncome, final];
  return [...prefix, accept, final];
}

// ---------------------------------------------------------------------------------------------------------------
// Languages: the English above, Chinese in script.zh.ts (title, caption and badge per step id).
// ---------------------------------------------------------------------------------------------------------------

const ALL = [...prefix, accept, dispute, resolve, wait, claimTimeout, final, vaultIncome];
const STEP_TEXT: Record<string, Pick<DemoStep, "title" | "caption" | "demoOnly">> = Object.fromEntries(
  ALL.map((s) => [s.id, { title: s.title, caption: s.caption, demoOnly: s.demoOnly }]),
);
/** Step title, caption and badge by step id, in a language. */
export const stepText = localized(STEP_TEXT, zhSteps);
/** The story picker's labels in a language. */
export const paths = localized(PATHS, zhPaths);
/** A transaction label as the steps record it, in a language. */
export const txLabel = (label: string, lang: Lang) => (lang === "zh" ? zhTxLabel(label) : label);
/** A demo rental's name (PROPERTIES) in a language. */
export const propertyName = (name: string, lang: Lang) => (lang === "zh" ? zhPropertyName(name) : name);

export function stepsFor(path: DemoPath, lang: Lang = "en"): DemoStep[] {
  const text = stepText(lang);
  return pathSteps(path).map((s) => ({ ...s, ...text[s.id] }));
}

/**
 * The summary's books: what the renter paid in must equal what the renter got back plus what the owner and the
 * treasury received, with the escrow left empty. Faucet mints happen before the `before` snapshot.
 */
export function ledger(ctx: DemoCtx) {
  if (!ctx.before || !ctx.after) return undefined;
  const paidIn = need(ctx);
  const tenantBack = ctx.after.tenant - ctx.before.tenant + paidIn;
  // The owner's side: the owner's wallet plus the Fleet Vault (which receives the owner's cut on the Fleet Vault path).
  const landlord = ctx.after.landlord - ctx.before.landlord + (ctx.after.vault - ctx.before.vault);
  // The treasury wallet is shared by every rental, so another rental's fee can land in the same window: use this
  // rental's own ProtocolFeePaid amount when the run saw it, the wallet delta otherwise.
  const treasury = ctx.fee ?? ctx.after.treasury - ctx.before.treasury;
  const escrowLeft = ctx.after.escrow;
  const balanced = escrowLeft === BigInt(0) && tenantBack + landlord + treasury === paidIn;
  return { paidIn, tenantBack, landlord, treasury, escrowLeft, balanced };
}
