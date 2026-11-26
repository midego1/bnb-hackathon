/**
 * KeyScrow rental actions: each one defined ONCE here, then served everywhere from that definition:
 *   REST  GET/POST /api/v1/<name> + the OpenAPI 3.1 document  (lib/actions/rest.ts, lib/actions/openapi.ts)
 *   MCP   one tool per action on the KeyScrow Inspector agent (agent/src/mcp.ts) and an A2A skill per action
 *   Web   the forms validate with the same input schemas (fieldError in lib/actions/fields.ts)
 *
 * Reads return JSON. Writes are NON-CUSTODIAL: prepare_* returns unsigned transactions, already dry-run on the
 * chain, for the caller's own wallet to sign. Nothing here holds or uses a private key.
 *
 * Roles: owner = `landlord` on-chain, renter = `tenant` on-chain, arbiter = the dispute desk.
 * To add an action or a field, see "How to add an action" in docs/AGENT.md.
 */
import { zeroAddress, type Address } from "viem";
import { z } from "zod";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "../contracts";
import { formatFiat } from "../fiat";
import { hashText, ZERO_HASH } from "../hash";
import { ActionError, type ActionContext } from "./context";
import { explainLease } from "./explain";
import { field, formatToken, fromField, leaseField, parseTokenAmount, TOKEN, type StatusName } from "./fields";
import { leaseJson, readLease, ROLE_LABEL, rpcError, type LeaseSnapshot, type Role } from "./lease";
import { oneTimeFee, periodCount, periodName, rentPerPeriod } from "../rentals";
import type { Call, Prepared } from "./simulate";

// ---------------------------------------------------------------------------------------------------------
// The definition shape
// ---------------------------------------------------------------------------------------------------------

type Base<S extends z.ZodObject> = {
  /** snake_case; also the MCP tool name and the REST path segment. */
  name: string;
  title: string;
  /** Written for an LLM and a person alike: what it does, when to use it, what comes back. */
  description: string;
  /** Who may call it. */
  roles: Role[];
  /** Lease status it needs (prepare_* with a `lease` input; checked before simulating). */
  statuses?: StatusName[];
  /** Refused up front once the renter's reply window has closed (KE-02): only prepare_claim_timeout still works. */
  needsOpenResponseWindow?: true;
  input: S;
  /** A valid input, used in the docs' curl examples and checked by the tests. */
  example: z.input<S>;
};

/** What a prepare_* action wants signed; the runner encodes and simulates it. */
export type Plan = {
  calls: Call[];
  summary: string;
  /** Pull values out of the simulation's return data, e.g. the address of a lease about to be created. */
  pick?: (results: { data: `0x${string}`; result?: unknown }[]) => Record<string, unknown> | undefined;
};

export type ReadAction<S extends z.ZodObject = z.ZodObject> = Base<S> & {
  kind: "read";
  // Method syntax (bivariant) so every concrete action is assignable to the generic `Action`.
  run(input: z.output<S>, ctx: ActionContext): Promise<unknown>;
};

export type PrepareAction<S extends z.ZodObject = z.ZodObject> = Base<S> & {
  kind: "prepare";
  /** `lease` is the snapshot of input.lease, already checked against `statuses` and `roles`. */
  build(input: z.output<S>, env: { ctx: ActionContext; lease: LeaseSnapshot | undefined }): Promise<Plan>;
};

export type Action = ReadAction | PrepareAction;

const read = <S extends z.ZodObject>(a: Omit<ReadAction<S>, "kind">): ReadAction<S> => ({ kind: "read", ...a });
const prepare = <S extends z.ZodObject>(a: Omit<PrepareAction<S>, "kind">): PrepareAction<S> => ({ kind: "prepare", ...a });

// ---------------------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------------------

/**
 * Anvil's seeded demo lease and dev accounts (deterministic on a fresh `pnpm chain:deploy && pnpm chain:seed`). Other
 * chains have no fixed demo rental: /developers swaps these for the newest rental in the chain index (withSample).
 */
export const EX = {
  lease: "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e",
  owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  renter: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  arbiter: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  hash: "0x9d9e1f7ac51b4a8f8a3c1f0b3d8f0f6e3e2b1c0d9a8b7c6d5e4f3a2b1c0d9e8f",
};

/** `example` with the anvil values of EX replaced by a live rental and its parties (lease, owner, renter, arbiter). */
export function withSample<T extends Record<string, unknown>>(example: T, sample: Partial<Record<"lease" | "owner" | "renter" | "arbiter", string>> | undefined): T {
  if (!sample) return example;
  const swap = new Map(Object.entries(sample).map(([k, v]) => [EX[k as keyof typeof EX], v]));
  return Object.fromEntries(Object.entries(example).map(([k, v]) => [k, swap.get(v as string) ?? v])) as T;
}

const chainId = field.chainId;

const amount = (v: bigint) => ({ units: v.toString(), display: formatToken(v) });

/** Best-effort fiat equivalents of a token amount ({THB, USD, mock}); omitted when no price source is wired in. */
async function fiat(ctx: ActionContext, units: bigint) {
  if (!ctx.prices) return undefined;
  try {
    const q = await ctx.prices();
    const n = Number(units) / 10 ** TOKEN.decimals;
    return { THB: formatFiat(n * q.rates.USDT.THB, "THB"), USD: formatFiat(n * q.rates.USDT.USD, "USD"), mock: q.mock };
  } catch {
    return undefined;
  }
}

const days = (s: number) => `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? "" : "s"}`;

const ROLE_FN = { owner: "leasesByLandlord", renter: "leasesByTenant", arbiter: "leasesByArbiter" } as const;

const MAX_DEPOSIT_MONTHS = 12;

// ---------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------

export const getLease = read({
  name: "get_lease",
  title: "Get a rental",
  description:
    "Read one KeyScrow rental straight from the chain: owner, renter, dispute desk, rent and deposit (in mUSDT, with baht/dollar " +
    "equivalents), rent period, periods paid and paid out, the current deposit proposal and any running deadline. Use explain_status " +
    "for a plain-language summary instead.",
  roles: ["anyone"],
  input: z.object({ lease: leaseField(), chainId: chainId() }).strict(),
  example: { lease: EX.lease },
  run: async ({ lease }, ctx) => {
    const l = await readLease(ctx, lease);
    return { ...leaseJson(l), depositFiat: await fiat(ctx, l.terms.depositAmount), rentFiat: await fiat(ctx, l.terms.rentAmount) };
  },
});

export const listLeases = read({
  name: "list_leases",
  title: "List rentals of a wallet",
  description:
    "List the KeyScrow rentals a wallet is part of, newest first, from the factory's on-chain index (no indexer needed). " +
    "Give `role` to only list rentals where the wallet is the owner, the renter or the dispute desk.",
  roles: ["anyone"],
  input: z
    .object({
      party: field.address({ title: "Wallet", description: "The wallet whose rentals to list." }),
      role: z
        .enum(["owner", "renter", "arbiter"])
        .optional()
        .meta({ title: "Role", description: "Only rentals where the wallet has this role (owner = landlord, renter = tenant, arbiter = dispute desk). Default: all three." }),
      limit: field.int(1, 50, { title: "Limit", description: "Most rentals to return per role (newest first)." }).default(20),
      chainId: chainId(),
    })
    .strict(),
  example: { party: EX.renter, role: "renter" },
  run: async ({ party, role, limit }, ctx) => {
    const roles = role ? [role] : (["owner", "renter", "arbiter"] as const);
    try {
      const out = [];
      for (const r of roles) {
        const list = await ctx.client.readContract({ address: ctx.deployment.escrowFactory, abi: escrowFactoryAbi, functionName: ROLE_FN[r], args: [party] });
        for (const address of [...list].reverse().slice(0, limit)) {
          const [status, terms] = await Promise.all([
            ctx.client.readContract({ address, abi: rentalEscrowAbi, functionName: "status" }),
            ctx.client.readContract({ address, abi: rentalEscrowAbi, functionName: "terms" }),
          ]);
          out.push({
            address,
            role: r,
            status: (["Created", "Active", "MoveOut", "Disputed", "Settled", "Cancelled"] as const)[status],
            rent: amount(terms.rentAmount),
            deposit: amount(terms.depositAmount),
            termPeriods: terms.termPeriods,
            rentPeriodDays: terms.rentPeriod / 86400,
          });
        }
      }
      return { chainId: ctx.chainId, party, count: out.length, leases: out };
    } catch (err) {
      throw rpcError(err);
    }
  },
});

export const explainStatus = read({
  name: "explain_status",
  title: "Explain where the deposit is",
  description:
    "Plain-language answer to \"where is my deposit and what happens next?\" for one rental: who holds the deposit, what each " +
    "party can do now (with the prepare_* tool for it), and who must act by when (deadlines in UTC, from chain time). Pass " +
    "`viewer` to phrase it for that wallet. Show the `text` field to the person as is.",
  roles: ["anyone"],
  input: z
    .object({
      lease: leaseField(),
      viewer: field.address({ title: "Viewer wallet", description: "Optional: the person asking, so the answer says what *they* can do." }).optional(),
      chainId: chainId(),
    })
    .strict(),
  example: { lease: EX.lease, viewer: EX.renter },
  run: async ({ lease, viewer }, ctx) => {
    const l = await readLease(ctx, lease);
    return { lease, chainId: ctx.chainId, ...explainLease(l, viewer), depositFiat: await fiat(ctx, l.terms.depositAmount) };
  },
});

export const quote = read({
  name: "quote",
  title: "Convert baht / dollars / mUSDT",
  description:
    "Convert an amount between Thai baht (THB), US dollars (USD) and the rental token (mUSDT, a test USDT) at the current rate " +
    "(Atlas on-chain feeds, then CoinMarketCap, else clearly marked demo rates: check `mock`). Use it to turn \"3,000 baht a month\" " +
    "into the mUSDT amount the contract stores.",
  roles: ["anyone"],
  input: z
    .object({
      amount: field.money({ title: "Amount", description: 'Amount to convert, e.g. "18000".' }),
      currency: field.currency({ title: "Currency", description: "Currency of `amount`: THB, USD or USDT (= mUSDT)." }).default("THB"),
    })
    .strict(),
  example: { amount: "18000", currency: "THB" },
  run: async ({ amount: amt, currency }, ctx) => {
    const q = await priceQuote(ctx);
    const usdt = toToken(amt, currency, q);
    const n = Number(usdt) / 10 ** TOKEN.decimals;
    return {
      input: { amount: amt, currency },
      mUSDT: amount(usdt),
      THB: { value: Number((n * q.rates.USDT.THB).toFixed(2)), display: formatFiat(n * q.rates.USDT.THB, "THB") },
      USD: { value: Number((n * q.rates.USDT.USD).toFixed(2)), display: formatFiat(n * q.rates.USDT.USD, "USD") },
      rate: { THB_per_USDT: q.rates.USDT.THB, USD_per_USDT: q.rates.USDT.USD },
      source: q.source,
      mock: q.mock,
      updatedAt: q.updatedAt,
    };
  },
});

export const walletHistory = read({
  name: "wallet_history",
  title: "Wallet history for the dispute desk",
  description:
    "A wallet's track record on KeyScrow, for a dispute: rentals as renter and as owner, how many settled, every dispute (who " +
    "opened it, who got what), the owner's deposit claims next to the AI inspection's proposal, rent paid on time vs late, and " +
    "timeouts. Exact numbers from the chain; `summary` says it in plain sentences. `memory` lists what Living Brain remembers " +
    "about the wallet (one factual entry per settled rental, with its transaction). Wallet addresses only, no names. The AI " +
    "summarises; the dispute desk decides.",
  roles: ["anyone"],
  input: z.object({ wallet: field.address({ title: "Wallet", description: "The renter's or owner's wallet." }), chainId: chainId() }).strict(),
  example: { wallet: EX.renter },
  run: async ({ wallet }, ctx) => {
    if (!ctx.history) throw new ActionError(503, "rpc_unavailable", "Wallet history needs the KeyScrow web server (chain index + memory); call /api/v1/wallet_history there.");
    try {
      return await ctx.history(wallet);
    } catch (err) {
      throw rpcError(err);
    }
  },
});

async function priceQuote(ctx: ActionContext) {
  if (!ctx.prices) throw new ActionError(502, "rpc_unavailable", "No price source is configured on this server.");
  return ctx.prices();
}

/** Fiat or USDT amount -> token base units, rounded to the cent (like the seeded demo rent). */
function toToken(amt: string, currency: "THB" | "USD" | "USDT", q: Awaited<ReturnType<typeof priceQuote>>): bigint {
  if (currency === "USDT") {
    const u = parseTokenAmount(amt);
    if (u === undefined) throw new ActionError(400, "invalid_input", `At most ${TOKEN.decimals} decimals for a USDT amount.`);
    return u;
  }
  const rate = q.rates.USDT[currency];
  return parseTokenAmount((Number(amt) / rate).toFixed(2))!;
}

// ---------------------------------------------------------------------------------------------------------
// Writes: prepare_* (unsigned, simulated)
// ---------------------------------------------------------------------------------------------------------

const toRenterField = () =>
  field.tokenAmount({ title: "Deposit back to the renter", description: "How much of the deposit goes back to the renter, in mUSDT (e.g. \"400\"). The rest goes to the owner." });

export const prepareCreateLease = prepare({
  name: "prepare_create_lease",
  title: "Create a rental",
  description:
    "Prepare the transaction that creates a rental offer, signed by the owner. Amounts can be given in baht, dollars or mUSDT; " +
    "baht/dollars are converted at the current rate (see `summary`). `rent` is a monthly price; with weekly or two-weekly rent " +
    "(`rentPeriodDays` 7 or 14) the rent per period is monthly x days / 30, rounded down. The deposit is either an amount or a " +
    "number of months of rent. The renter then funds it with prepare_fund. Returns the unsigned transaction and, in `expected.lease`, the rental's " +
    "address if nobody else creates one first.",
  roles: ["owner"],
  input: z
    .object({
      from: fromField("the owner, who becomes the landlord on-chain"),
      renter: field.address({ title: "Renter wallet", description: "Wallet of the renter (tenant on-chain); it pays the deposit and rent." }),
      rent: field.money({ title: "Monthly rent", description: 'Rent per 30-day month, in `currency`, e.g. "3000". Charged per rent period (see `rentPeriodDays`).', "x-unit": "currency" }),
      rentPeriodDays: z.coerce
        .number({ message: "Enter 7, 14 or 30." })
        .refine((d) => d === 7 || d === 14 || d === 30, "7, 14 or 30 days.")
        .default(30)
        .meta({ title: "Rent period", description: "How often rent is paid: every 7, 14 or 30 days (default 30).", "x-unit": "days" }),
      currency: field.currency({ title: "Currency", description: "Currency of `rent` and `deposit`: THB (default), USD or USDT (= mUSDT, stored as is)." }).default("THB"),
      deposit: field.money({ title: "Deposit", description: "Security deposit, in `currency`. Give this or `depositMonths`." }).optional(),
      depositMonths: field
        .int(1, MAX_DEPOSIT_MONTHS, { title: "Deposit (months of rent)", description: "Security deposit as a number of months of rent, e.g. 2. Give this or `deposit`.", "x-unit": "months" })
        .optional(),
      termPeriods: field.int(1, 60, { title: "Term", description: "Length of the rental in rent periods (1 to 60), e.g. 4 with weekly rent = 4 weeks.", "x-unit": "periods" }),
      responseWindowDays: field
        .int(1, 60, { title: "Owner's reply window", description: "Days the owner has to answer the renter's return proposal; if silent, the full deposit goes back to the renter.", "x-unit": "days" })
        .default(7),
      arbiterWindowDays: field
        .int(1, 90, { title: "Dispute desk deadline", description: "Days the dispute desk has to rule on a dispute; after that the full deposit can go back to the renter.", "x-unit": "days" })
        .default(14),
      arbiter: field.address({ title: "Dispute desk", description: "Optional: your own neutral reviewer. Omit to use the KeyScrow dispute desk." }).optional(),
      leaseHash: field.bytes32({ title: "Rental agreement hash", description: "Optional sha256 of the signed agreement (from POST /api/evidence)." }).optional(),
      payee: field
        .address({ title: "Payout address", description: "Optional: where the owner's rent and any deposit claim are paid, e.g. a Fleet Vault whose shareholders own the scooter. The owner keeps every role. Default: the owner." })
        .optional(),
      chainId: chainId(),
    })
    .strict()
    .refine((v) => (v.deposit === undefined) !== (v.depositMonths === undefined), { message: "Give either `deposit` or `depositMonths`.", path: ["deposit"] }),
  example: { from: EX.owner, renter: EX.renter, rent: "18000", currency: "THB", depositMonths: 2, termPeriods: 12 },
  build: async (i, { ctx }) => {
    const q = i.currency === "USDT" ? undefined : await priceQuote(ctx);
    const monthly = toToken(i.rent, i.currency, q!);
    const period = i.rentPeriodDays * 86400;
    const rent = rentPerPeriod(monthly, period);
    if (rent === BigInt(0)) throw new ActionError(400, "invalid_input", "The rent per period rounds down to 0. Raise the rent.");
    const deposit = i.deposit !== undefined ? toToken(i.deposit, i.currency, q!) : monthly * BigInt(i.depositMonths!);
    const desk = i.arbiter ?? ctx.deployment.disputeDesk;
    const rate = q ? ` (${i.currency} ${i.rent} at ${q.rates.USDT[i.currency as "THB" | "USD"].toFixed(2)} ${i.currency}/USDT${q.mock ? ", demo rate" : ""})` : "";
    const params = {
      tenant: i.renter,
      arbiter: i.arbiter ?? zeroAddress,
      rentAmount: rent,
      depositAmount: deposit,
      termPeriods: i.termPeriods,
      rentPeriod: period,
      responseWindow: i.responseWindowDays * 86400,
      arbiterWindow: i.arbiterWindowDays * 86400,
      leaseHash: i.leaseHash ?? ZERO_HASH,
    };
    return {
      calls: [
        i.payee
          ? { to: ctx.deployment.escrowFactory, abi: escrowFactoryAbi, functionName: "createLeaseWithPayee", args: [params, i.payee], description: "Create the rental offer (payouts to the payee)" }
          : { to: ctx.deployment.escrowFactory, abi: escrowFactoryAbi, functionName: "createLease", args: [params], description: "Create the rental offer" },
      ],
      summary:
        `Create a rental of ${periodCount(i.termPeriods, period)} for renter ${i.renter}: rent ${formatToken(rent)} per ${periodName(period)}${rate}, deposit ` +
        `${formatToken(deposit)}${i.depositMonths ? ` (${i.depositMonths} month${i.depositMonths > 1 ? "s" : ""} of rent)` : ""}. ` +
        `The owner has ${i.responseWindowDays} days to answer a return proposal; the dispute desk ${desk ?? "(factory default)"} has ` +
        `${i.arbiterWindowDays} days to rule on a dispute.${i.payee ? ` Rent and any deposit claim are paid to ${i.payee}.` : ""} KeyScrow's one-time fee comes out of the owner's first rent payout, never the deposit. ` +
        `Next: the renter funds ${formatToken(deposit + rent)} (deposit + the first ${periodName(period)}) with prepare_fund.`,
      pick: (r) => (typeof r[0]?.result === "string" ? { lease: r[0].result as Address, rent: amount(rent), deposit: amount(deposit) } : undefined),
    };
  },
});

export const prepareFund = prepare({
  name: "prepare_fund",
  title: "Fund the rental (renter)",
  description:
    "Prepare the renter's transactions to start the rental: approve the escrow to take deposit + the first period's rent " +
    "(skipped if already approved), then fund(). Sign them in order.",
  roles: ["renter"],
  statuses: ["Created"],
  input: z.object({ lease: leaseField(), from: fromField("the renter"), chainId: chainId() }).strict(),
  example: { lease: EX.lease, from: EX.renter },
  build: async ({ lease, from }, { ctx, lease: l }) => {
    const need = l!.terms.depositAmount + l!.terms.rentAmount;
    const allowance = await ctx.client
      .readContract({ address: l!.terms.token, abi: mockUsdtAbi, functionName: "allowance", args: [from, lease] })
      .catch((e) => Promise.reject(rpcError(e)));
    const calls: Call[] = [];
    if (allowance < need) {
      calls.push({ to: l!.terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease, need], description: `Approve ${formatToken(need)} for the escrow` });
    }
    calls.push({ to: lease, abi: rentalEscrowAbi, functionName: "fund", description: "Pay the deposit and the first period's rent into escrow" });
    return {
      calls,
      summary:
        `Pay ${formatToken(need)} into escrow: ${formatToken(l!.terms.depositAmount)} deposit + ${formatToken(l!.terms.rentAmount)} rent for the first ${periodName(l!.terms.rentPeriod)}. ` +
        `The deposit stays locked until owner and renter agree, the dispute desk rules, or a deadline passes.`,
    };
  },
});

export const prepareReleaseRent = prepare({
  name: "prepare_release_rent",
  title: "Pay out due rent",
  description:
    "Prepare the transaction that pays funded rent out to the owner. Anyone may release rent periods that are due; the renter may " +
    "also release prepaid periods early.",
  roles: ["anyone"],
  statuses: ["Active", "MoveOut", "Disputed"],
  input: z.object({ lease: leaseField(), from: fromField("anyone; the renter may also release early"), chainId: chainId() }).strict(),
  example: { lease: EX.lease, from: EX.owner },
  build: async ({ lease, from }, { lease: l }) => {
    const isRenter = l!.terms.renter.toLowerCase() === from.toLowerCase();
    const upTo = isRenter ? l!.periodsFunded : Math.min(l!.periodsDue, l!.periodsFunded);
    const periods = Math.max(0, upTo - l!.periodsReleased);
    if (periods === 0) throw new ActionError(409, "precondition_failed", "There is no funded rent due for release right now.");
    const gross = BigInt(periods) * l!.terms.rentAmount;
    const fee = l!.feeCharged ? BigInt(0) : oneTimeFee(l!.terms.rentAmount, l!.terms.rentPeriod, l!.terms.feeBps);
    const what = `${periodCount(periods, l!.terms.rentPeriod)} of rent`;
    return {
      calls: [{ to: lease, abi: rentalEscrowAbi, functionName: "releaseRent", description: `Pay ${what} to the owner` }],
      summary: `Pay ${what} (${formatToken(gross)}) to the owner${fee > 0 ? `, minus KeyScrow's one-time fee of ${formatToken(fee)}` : ""}.`,
    };
  },
});

export const prepareAddEvidence = prepare({
  name: "prepare_add_evidence",
  title: "Anchor photos or a document",
  description:
    "Prepare the transaction that anchors the hash of off-chain evidence (pickup photos, return photos, a report) on the rental. " +
    "Upload the file first with POST /api/evidence and pass the returned sha256 `hash` here.",
  roles: ["owner", "renter"],
  statuses: ["Created", "Active", "MoveOut", "Disputed"],
  input: z
    .object({
      lease: leaseField(),
      from: fromField("the owner or the renter"),
      kind: z.enum(["check_in", "check_out", "other"]).meta({ title: "Kind", description: "check_in = pickup photos, check_out = return photos, other = anything else." }),
      contentHash: field.bytes32({ title: "Content hash", description: "sha256 of the file (or photo manifest) from POST /api/evidence." }),
      chainId: chainId(),
    })
    .strict(),
  example: { lease: EX.lease, from: EX.renter, kind: "check_out", contentHash: EX.hash },
  build: async ({ lease, kind, contentHash }) => ({
    calls: [
      {
        to: lease,
        abi: rentalEscrowAbi,
        functionName: "addEvidence",
        args: [{ check_in: 0, check_out: 1, other: 2 }[kind], contentHash],
        description: `Anchor ${kind.replace("_", "-")} evidence`,
      },
    ],
    summary: `Record ${contentHash} as ${{ check_in: "pickup", check_out: "return", other: "other" }[kind]} evidence on the rental. Only the hash goes on-chain.`,
  }),
});

const inspectionField = () =>
  z
    .object({
      tenantRefund: z.string().regex(/^\d+$/).meta({ title: "Refund (base units)", description: "From the inspection result." }),
      reportHash: field.bytes32({ title: "Report hash", description: "From the inspection result." }),
      deposit: z.string().regex(/^\d+$/).optional(),
    })
    .loose()
    .meta({
      title: "AI inspection result",
      description: "The full result of the inspect_move_out tool (or POST /api/settlement). Its tenantRefund and reportHash are used as is.",
    });

export const prepareProposeSettlement = prepare({
  name: "prepare_propose_settlement",
  title: "Propose the deposit split",
  description:
    "Prepare the transaction that proposes how the deposit is split at return. Either pass the AI inspection result " +
    "(`inspection`, from inspect_move_out) or an amount (`toRenter`) with an optional `note`. A new proposal replaces the previous " +
    "one. If the renter proposes and the owner stays silent past the reply window, the full deposit goes back to the renter.",
  roles: ["owner", "renter"],
  statuses: ["Active", "MoveOut"],
  needsOpenResponseWindow: true,
  input: z
    .object({
      lease: leaseField(),
      from: fromField("the owner or the renter"),
      toRenter: toRenterField().optional(),
      inspection: inspectionField().optional(),
      reportHash: field.bytes32({ title: "Report hash", description: "Optional hash of your own report backing the split (default: hash of `note`)." }).optional(),
      note: field.text(1000, { title: "Reason", description: "Optional short reason, hashed into reportHash when no report is given." }).optional(),
      chainId: chainId(),
    })
    .strict()
    .refine((v) => (v.toRenter === undefined) !== (v.inspection === undefined), { message: "Give either `toRenter` or `inspection`.", path: ["toRenter"] }),
  example: { lease: EX.lease, from: EX.renter, toRenter: "800", note: "Small scratch on the left panel" },
  build: async (i, { lease: l }) => {
    const dep = l!.terms.depositAmount;
    if (i.inspection?.deposit !== undefined && BigInt(i.inspection.deposit) !== dep) {
      throw new ActionError(409, "precondition_failed", `The inspection was run for a deposit of ${formatToken(BigInt(i.inspection.deposit))}, but this rental holds ${formatToken(dep)}.`);
    }
    const toRenter = i.inspection ? BigInt(i.inspection.tenantRefund) : i.toRenter!;
    if (toRenter > dep) throw new ActionError(400, "invalid_input", `Cannot give back more than the deposit (${formatToken(dep)}).`);
    const reportHash = i.inspection?.reportHash ?? i.reportHash ?? hashText(JSON.stringify({ tenantRefund: toRenter.toString(), note: i.note ?? "" }));
    return {
      calls: [{ to: i.lease, abi: rentalEscrowAbi, functionName: "propose", args: [toRenter, reportHash], description: "Propose the deposit split" }],
      summary:
        `Propose: ${formatToken(toRenter)} back to the renter, ${formatToken(dep - toRenter)} to the owner` +
        `${i.inspection ? " (from the AI inspection)" : ""}. The other side can accept, counter or dispute.`,
    };
  },
});

export const prepareAccept = prepare({
  name: "prepare_accept",
  title: "Accept the proposal",
  description:
    "Prepare the transaction that accepts the current deposit proposal; the deposit pays out immediately. Only the side that did " +
    "NOT make the proposal can accept. Pass `nonce` (from get_lease) to make sure you accept exactly the proposal you reviewed.",
  roles: ["owner", "renter"],
  statuses: ["MoveOut"],
  needsOpenResponseWindow: true,
  input: z
    .object({
      lease: leaseField(),
      from: fromField("the side that did not make the proposal"),
      nonce: field.int(1, 2 ** 32 - 1, { title: "Proposal number", description: "Optional: the proposal # you reviewed. Default: the current one." }).optional(),
      chainId: chainId(),
    })
    .strict(),
  example: { lease: EX.lease, from: EX.owner, nonce: 1 },
  build: async ({ lease, from, nonce }, { lease: l }) => {
    const p = l!.proposal;
    if (p.proposer.toLowerCase() === from.toLowerCase()) {
      throw new ActionError(409, "precondition_failed", `You made proposal #${p.nonce}, so the other side has to accept it.`);
    }
    const n = nonce ?? p.nonce;
    return {
      calls: [{ to: lease, abi: rentalEscrowAbi, functionName: "accept", args: [n], description: `Accept proposal #${n}` }],
      summary: `Accept proposal #${n}: ${formatToken(p.tenantRefund)} back to the renter, ${formatToken(p.landlordClaim)} to the owner, paid out now. Due rent goes to the owner and prepaid rent back to the renter.`,
    };
  },
});

export const prepareDispute = prepare({
  name: "prepare_dispute",
  title: "Open a dispute",
  description:
    "Prepare the transaction that sends the rental to the dispute desk. The deposit stays frozen until the desk rules; if it does " +
    "not rule within its deadline, the full deposit can go back to the renter.",
  roles: ["owner", "renter"],
  statuses: ["Active", "MoveOut"],
  needsOpenResponseWindow: true,
  input: z.object({ lease: leaseField(), from: fromField("the owner or the renter"), chainId: chainId() }).strict(),
  example: { lease: EX.lease, from: EX.renter },
  build: async ({ lease }, { lease: l }) => ({
    calls: [{ to: lease, abi: rentalEscrowAbi, functionName: "dispute", description: "Open a dispute" }],
    summary: `Send the rental to the dispute desk ${l!.terms.arbiter}. It has ${days(l!.terms.arbiterWindow)} to rule; after that anyone can return the full deposit to the renter.`,
  }),
});

export const prepareResolve = prepare({
  name: "prepare_resolve",
  title: "Rule on a dispute (dispute desk)",
  description:
    "Prepare the dispute desk's ruling on the deposit split. Only the rental's arbiter can sign it, and only before its deadline. " +
    "Give the written `ruling` (hashed on-chain) or the `rulingHash` of an uploaded ruling document.",
  roles: ["arbiter"],
  statuses: ["Disputed"],
  input: z
    .object({
      lease: leaseField(),
      from: fromField("the dispute desk"),
      toRenter: toRenterField(),
      ruling: field.text(4000, { title: "Ruling", description: "The written ruling; its sha256 goes on-chain." }).optional(),
      rulingHash: field.bytes32({ title: "Ruling hash", description: "Or: sha256 of an uploaded ruling document." }).optional(),
      chainId: chainId(),
    })
    .strict()
    .refine((v) => v.ruling !== undefined || v.rulingHash !== undefined, { message: "Give the `ruling` text or a `rulingHash`.", path: ["ruling"] }),
  example: { lease: EX.lease, from: EX.arbiter, toRenter: "782.36", ruling: "Repaint claim partly upheld: 100 mUSDT to the owner." },
  build: async (i, { lease: l }) => {
    const dep = l!.terms.depositAmount;
    if (i.toRenter > dep) throw new ActionError(400, "invalid_input", `Cannot give back more than the deposit (${formatToken(dep)}).`);
    // Same formula as the web app's ResolvePanel, so a ruling typed in either place hashes identically.
    const rulingHash = i.rulingHash ?? hashText(JSON.stringify({ tenantRefund: i.toRenter.toString(), ruling: i.ruling }));
    return {
      calls: [{ to: i.lease, abi: rentalEscrowAbi, functionName: "resolve", args: [i.toRenter, rulingHash], description: "Rule on the dispute" }],
      summary: `Rule: ${formatToken(i.toRenter)} back to the renter, ${formatToken(dep - i.toRenter)} to the owner. Pays out immediately.`,
    };
  },
});

export const prepareClaimTimeout = prepare({
  name: "prepare_claim_timeout",
  title: "Claim a missed deadline",
  description:
    "Prepare the transaction that closes a rental after a missed deadline, returning the FULL deposit to the renter: either the " +
    "owner did not answer the renter's proposal within the reply window, or the dispute desk did not rule within its deadline. " +
    "Anyone can send it once the deadline has passed (see explain_status).",
  roles: ["anyone"],
  statuses: ["MoveOut", "Disputed"],
  input: z.object({ lease: leaseField(), from: fromField("anyone"), chainId: chainId() }).strict(),
  example: { lease: EX.lease, from: EX.renter },
  build: async ({ lease }, { lease: l }) => {
    const disputed = l!.status === "Disputed";
    if (!disputed && l!.timeoutAt === BigInt(0)) {
      throw new ActionError(409, "precondition_failed", "The reply timeout only applies to a proposal made by the renter; this one was made by the owner.");
    }
    return {
      calls: [
        disputed
          ? { to: lease, abi: rentalEscrowAbi, functionName: "claimArbiterTimeout", description: "Close the dispute after the desk's deadline" }
          : { to: lease, abi: rentalEscrowAbi, functionName: "claimTimeout", description: "Close after the owner's reply window" },
      ],
      summary: `Return the full ${formatToken(l!.terms.depositAmount)} deposit to the renter because ${disputed ? "the dispute desk did not rule in time" : "the owner did not answer in time"}. Due rent still goes to the owner, prepaid rent back to the renter.`,
    };
  },
});

export const prepareCancel = prepare({
  name: "prepare_cancel",
  title: "Withdraw an unfunded offer",
  description: "Prepare the owner's transaction that withdraws a rental offer the renter has not funded yet. No money moves.",
  roles: ["owner"],
  statuses: ["Created"],
  input: z.object({ lease: leaseField(), from: fromField("the owner"), chainId: chainId() }).strict(),
  example: { lease: EX.lease, from: EX.owner },
  build: async ({ lease }) => ({
    calls: [{ to: lease, abi: rentalEscrowAbi, functionName: "cancel", description: "Withdraw the offer" }],
    summary: "Withdraw this unfunded rental offer. It can no longer be funded afterwards.",
  }),
});

// ---------------------------------------------------------------------------------------------------------
// The table every face is generated from
// ---------------------------------------------------------------------------------------------------------

export const ACTIONS: readonly Action[] = [
  getLease,
  listLeases,
  explainStatus,
  quote,
  walletHistory,
  prepareCreateLease,
  prepareFund,
  prepareReleaseRent,
  prepareAddEvidence,
  prepareProposeSettlement,
  prepareAccept,
  prepareDispute,
  prepareResolve,
  prepareClaimTimeout,
  prepareCancel,
];

export function findAction(name: string): Action | undefined {
  return ACTIONS.find((a) => a.name === name);
}

/** The description every face shows: the definition's text plus who may call it and when. */
export function toolDescription(a: Action): string {
  const who = a.roles.map((r) => ROLE_LABEL[r]).join(" or ");
  const parts = [a.description, `Who: ${who}.`];
  if (a.statuses) parts.push(`Needs rental status: ${a.statuses.join(" or ")}.`);
  if (a.kind === "prepare") {
    parts.push(
      "Returns {chainId, steps:[{to, data, value, description}], summary} with UNSIGNED transactions, already simulated on the chain; " +
        "show the summary, then have the person sign the steps in order with their own wallet. Nothing is sent by this tool.",
    );
  }
  return parts.join(" ");
}

export type { Prepared };
