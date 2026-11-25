import { parseEventLogs, parseUnits, zeroAddress, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { escrowFactoryAbi, EvidenceKind, LeaseStatus, mockUsdtAbi, rentalEscrowAbi, type Deployment } from "../contracts";
import { devAccounts, type DevRole } from "../devAccounts";
import type { UploadedFile } from "../evidence";
import { hashText } from "../hash";
import type { InspectionPhoto, InspectionResult } from "../settlement";

/**
 * The guided one-click demo (/demo, local anvil only). Each step is a short, plain-English beat of the KeyEscrow
 * story that drives the real contracts through the same helpers as the normal UI (useTx, uploadEvidence,
 * runInspection). The runner (components/demo/DemoRunner.tsx) supplies `DemoApi`, switches the demo account
 * before each step and shows the caption, progress and transactions.
 */

export type DemoPath = "happy" | "dispute" | "timeout";
export type DemoActor = DevRole | "inspector" | "anyone";

export const PATHS: Record<DemoPath, { label: string; blurb: string }> = {
  happy: { label: "Happy path", blurb: "Tenant proposes the AI split, landlord accepts, money moves at once." },
  dispute: { label: "Dispute path", blurb: "Landlord disputes the proposal, the KeyEscrow dispute desk rules on a split." },
  timeout: { label: "Landlord ignores it", blurb: "Landlord stays silent for 7 days, so the full deposit goes back to the tenant." },
};

/** Realistic Bangkok rentals, priced in baht; a fresh lease each run cycles through them. */
export const PROPERTIES = [
  { name: "1-bed condo near BTS Ari", rentThb: 18_000 },
  { name: "Studio near BTS On Nut", rentThb: 12_500 },
  { name: "2-bed condo in Thonglor", rentThb: 32_000 },
] as const;
export type Property = (typeof PROPERTIES)[number];

const TERM_MONTHS = 12;
const RESPONSE_WINDOW = 7 * 86_400;
const ARBITER_WINDOW = 14 * 86_400;
const DEPOSIT_MONTHS = BigInt(2);
const UNIT = BigInt(1_000_000); // 1 mUSDT (6 decimals)

const CHECK_IN = [
  { file: "checkin-living-room.png", label: "Living room" },
  { file: "checkin-bedroom.png", label: "Bedroom" },
];
const CHECK_OUT = [
  { file: "checkout-living-room.png", label: "Living room" },
  { file: "checkout-bedroom.png", label: "Bedroom" },
];

export type Photo = { hash: Hex; label: string };
export type Balances = { tenant: bigint; landlord: bigint; treasury: bigint; escrow: bigint };
export type DemoTx = { label: string; hash: Hex };

/** Everything the steps learn as they go. Steps mutate it, so a retried step resumes where it failed. */
export type DemoCtx = {
  path: DemoPath;
  property: Property;
  rent: bigint;
  deposit: bigint;
  termMonths: number;
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
};

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

export type DemoApi = {
  deployment: Deployment;
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
  const rent = parseUnits((property.rentThb / rate).toFixed(2), 6);
  return { path, property, rent, deposit: rent * DEPOSIT_MONTHS, termMonths: TERM_MONTHS, checkInAnchored: 0, checkOutAnchored: 0 };
}

const need = (ctx: DemoCtx) => ctx.deposit + ctx.rent;
const leaseOf = (ctx: DemoCtx) => {
  if (!ctx.lease) throw new Error("The demo lease has not been created yet. Start over.");
  return ctx.lease;
};

async function balances(api: DemoApi, ctx: DemoCtx): Promise<Balances> {
  const bal = (who: Address) => api.read<bigint>({ address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "balanceOf", args: [who] });
  const [tenant, landlord, treasury, escrow] = await Promise.all([
    bal(devAccounts.tenant),
    bal(devAccounts.landlord),
    bal(ctx.treasury ?? zeroAddress),
    bal(leaseOf(ctx)),
  ]);
  return { tenant, landlord, treasury, escrow };
}

async function anchor(api: DemoApi, ctx: DemoCtx, kind: "CheckIn" | "CheckOut") {
  const photos = (kind === "CheckIn" ? ctx.checkIn : ctx.checkOut) ?? [];
  const field = kind === "CheckIn" ? "checkInAnchored" : "checkOutAnchored";
  const label = kind === "CheckIn" ? "check-in" : "check-out";
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
  const items = await api.upload(set.map((p) => ({ path: `/demo/walkthrough/${p.file}`, name: p.file, type: "image/png" })));
  return items.map((it, i) => ({ hash: it.hash, label: set[i].label }));
}

// ---------------------------------------------------------------------------------------------------------------
// Steps shared by every path: lease -> funding -> first rent -> move-out photos -> AI inspection -> proposal
// ---------------------------------------------------------------------------------------------------------------

const createLease: DemoStep = {
  id: "create",
  title: "Landlord offers the lease",
  actor: "landlord",
  caption: (c, m) =>
    `${c.property.name}: ${m(c.rent)} a month, ${m(c.deposit)} deposit (two months, the Bangkok norm), ${c.termMonths}-month term. ` +
    `The lease PDF and check-in photos are stored off-chain; only their SHA-256 fingerprints go on-chain. The KeyEscrow dispute desk is the default referee.`,
  async run(api, ctx) {
    await api.as("landlord");
    if (!ctx.leaseHash || !ctx.checkIn) {
      const [pdf] = await api.upload([{ path: "/demo/lease.pdf", name: "lease.pdf", type: "application/pdf" }]);
      ctx.leaseHash = pdf.hash;
      ctx.checkIn = await uploadPhotos(api, CHECK_IN);
    }
    if (!ctx.lease) {
      const receipt = await api.tx("Create lease", {
        address: api.deployment.escrowFactory,
        abi: escrowFactoryAbi,
        functionName: "createLease",
        args: [
          {
            tenant: devAccounts.tenant,
            arbiter: zeroAddress, // address(0) = the factory's default arbiter, the KeyEscrow dispute desk
            rentAmount: ctx.rent,
            depositAmount: ctx.deposit,
            termMonths: ctx.termMonths,
            responseWindow: RESPONSE_WINDOW,
            arbiterWindow: ARBITER_WINDOW,
            leaseHash: ctx.leaseHash,
          },
        ],
      });
      const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: receipt.logs });
      if (!created) throw new Error("The lease was created but its address could not be read from the receipt.");
      ctx.lease = created.args.escrow as Address;
    }
    const terms = await api.read<{ feeRecipient: Address; feeBps: number }>({ address: ctx.lease, abi: rentalEscrowAbi, functionName: "terms" });
    ctx.treasury = terms.feeRecipient;
    ctx.feeBps = Number(terms.feeBps);
  },
};

const recordCheckIn: DemoStep = {
  id: "checkin",
  title: "Check-in photos on record",
  actor: "landlord",
  caption: () =>
    "The landlord anchors the fingerprint of each check-in photo on the lease contract. At move-out the AI inspection compares against exactly these files; nobody can swap them later.",
  async run(api, ctx) {
    await api.as("landlord");
    await anchor(api, ctx, "CheckIn");
  },
};

const getUsdt: DemoStep = {
  id: "faucet",
  title: "Tenant gets demo mUSDT",
  actor: "tenant",
  caption: (c, m) =>
    c.faucet === BigInt(0)
      ? `The tenant already holds enough MockUSDT (the testnet stand-in for USDT) for ${m(need(c))}, so no faucet is needed.`
      : `MockUSDT is the testnet stand-in for USDT. The tenant taps its faucet for the ${m(need(c))} they need. On mainnet this would be real USDT.`,
  async run(api, ctx) {
    await api.as("tenant");
    const balance = await api.read<bigint>({ address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "balanceOf", args: [devAccounts.tenant] });
    if (balance >= need(ctx)) {
      ctx.faucet = BigInt(0);
      return;
    }
    await api.tx("Get test USDT", { address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "faucet", args: [devAccounts.tenant, need(ctx)] });
    ctx.faucet = need(ctx);
  },
};

const fund: DemoStep = {
  id: "fund",
  title: "Tenant funds deposit + first month",
  actor: "tenant",
  caption: (c, m) =>
    `Two wallet steps: approve, then fund. ${m(need(c))} moves into this lease's own escrow contract, not to the landlord. From here on, neither side can move the deposit alone.`,
  async run(api, ctx) {
    await api.as("tenant");
    const lease = leaseOf(ctx);
    ctx.before ??= await balances(api, ctx);
    const allowance = await api.read<bigint>({ address: api.deployment.mockUsdt, abi: mockUsdtAbi, functionName: "allowance", args: [devAccounts.tenant, lease] });
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
      `Month 1 is due on day one. The tenant releases it: ${m(c.rentToLandlord ?? c.rent - fee)} to the landlord and the one-time KeyEscrow fee of ${m(fee)} ` +
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
  title: "Move-out: check-out photos",
  actor: "tenant",
  caption: () =>
    "Move-out day. In real life eleven more months of rent flow the same way; the demo skips ahead. No clock is faked: settling the deposit does not depend on time. " +
    "The tenant records two check-out photos. The living-room wall has a scuff and the bedroom floor a stain.",
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
      ? `The KeyEscrow Inspector agent compared check-in and check-out photos: ${m(BigInt(c.inspection.tenantRefund))} back to the tenant, ` +
        `${m(BigInt(c.inspection.landlordClaim))} to the landlord for repairs. It drafts; it never decides. Its report hash goes on-chain with the proposal.`
      : "The KeyEscrow Inspector agent compares check-in and check-out photos and drafts a deposit split with reasons. It drafts; it never decides.",
  async run(api, ctx) {
    if (!ctx.checkIn || !ctx.checkOut) throw new Error("The photos are missing. Start over.");
    ctx.inspection = await api.inspect({ deposit: ctx.deposit, checkIn: ctx.checkIn, checkOut: ctx.checkOut });
  },
};

const propose: DemoStep = {
  id: "propose",
  title: "Tenant proposes the split on-chain",
  actor: "tenant",
  caption: (c, m) =>
    c.inspection
      ? `The tenant agrees with the AI and proposes it on-chain: ${m(BigInt(c.inspection.tenantRefund))} back, ${m(BigInt(c.inspection.landlordClaim))} to the landlord. ` +
        `Now the landlord has ${RESPONSE_WINDOW / 86_400} days to accept, counter or dispute.`
      : "The tenant proposes the AI split on-chain.",
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
  title: "Landlord accepts: instant settlement",
  actor: "landlord",
  caption: () => "The landlord reviews the photos and the AI reasons and accepts. One transaction pays everyone out: no agent, no court, no weeks of waiting.",
  async run(api, ctx) {
    await api.as("landlord");
    const receipt = await api.tx("Accept proposal", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "accept", args: [ctx.nonce ?? 1] });
    captureSettled(ctx, receipt);
  },
};

const dispute: DemoStep = {
  id: "dispute",
  title: "Landlord opens a dispute",
  actor: "landlord",
  caption: () =>
    `The landlord thinks the repairs cost more than the AI says and opens a dispute instead. Now only the KeyEscrow dispute desk can split the deposit, ` +
    `within ${ARBITER_WINDOW / 86_400} days; if it misses that deadline, the full deposit goes back to the tenant.`,
  async run(api, ctx) {
    await api.as("landlord");
    await api.tx("Open dispute", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "dispute" });
  },
};

/** The desk's ruling for the scripted dispute: half again the AI's repair estimate, in whole mUSDT. */
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
      `The dispute desk reviews the same photos and the AI report and rules: the landlord keeps ${m(r.landlordClaim)} for the repaint and cleaning, ` +
      `${m(r.tenantRefund)} goes back to the tenant. The ruling's fingerprint is stored on-chain with the payout.`
    );
  },
  async run(api, ctx) {
    await api.as("arbiter");
    const r = deskRuling(ctx);
    const text = `Ruling for lease ${ctx.lease}: wall repaint and floor cleaning quoted above the AI estimate. Landlord keeps ${r.landlordClaim} base units, tenant gets ${r.tenantRefund} back.`;
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
  title: "Landlord stays silent for 7 days",
  actor: "anyone",
  demoOnly: `fast-forward ${RESPONSE_WINDOW / 86_400} days (demo only)`,
  caption: () =>
    `The landlord does not answer. On a real chain we would wait ${RESPONSE_WINDOW / 86_400} days; on this local demo chain we fast-forward the block clock ` +
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
  title: "Full deposit back to the tenant",
  actor: "tenant",
  caption: (c, m) =>
    `The landlord's reply window has passed, so anyone can close the lease. The landlord never backed a claim, so the full ${m(c.deposit)} deposit goes back to the tenant, ` +
    "not just the AI split. Silence can never cost the tenant money.",
  async run(api, ctx) {
    await api.as("tenant");
    const receipt = await api.tx("Claim landlord timeout", { address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "claimTimeout" });
    captureSettled(ctx, receipt);
  },
};

const final: DemoStep = {
  id: "final",
  title: "Final balances",
  actor: "anyone",
  caption: () => "The escrow is empty and every baht is accounted for: what the tenant paid in went to the landlord, the KeyEscrow treasury, or back to the tenant.",
  async run(api, ctx) {
    ctx.after = await balances(api, ctx);
    ctx.finalStatus = Number(await api.read<number>({ address: leaseOf(ctx), abi: rentalEscrowAbi, functionName: "status" }));
    if (ctx.finalStatus !== LeaseStatus.Settled) throw new Error("The lease did not end up settled. Open the lease page to see why.");
    await api.refresh();
  },
};

const prefix = [createLease, recordCheckIn, getUsdt, fund, payRent, checkOut, inspect, propose];

export function stepsFor(path: DemoPath): DemoStep[] {
  if (path === "dispute") return [...prefix, dispute, resolve, final];
  if (path === "timeout") return [...prefix, wait, claimTimeout, final];
  return [...prefix, accept, final];
}

/**
 * The summary's books: what the tenant paid in must equal what the tenant got back plus what the landlord and the
 * treasury received, with the escrow left empty. Faucet mints happen before the `before` snapshot.
 */
export function ledger(ctx: DemoCtx) {
  if (!ctx.before || !ctx.after) return undefined;
  const paidIn = need(ctx);
  const tenantBack = ctx.after.tenant - ctx.before.tenant + paidIn;
  const landlord = ctx.after.landlord - ctx.before.landlord;
  const treasury = ctx.after.treasury - ctx.before.treasury;
  const escrowLeft = ctx.after.escrow;
  const balanced = escrowLeft === BigInt(0) && tenantBack + landlord + treasury === paidIn;
  return { paidIn, tenantBack, landlord, treasury, escrowLeft, balanced };
}
