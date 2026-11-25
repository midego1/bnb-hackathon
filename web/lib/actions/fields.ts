/**
 * Field types shared by every lease action (web/lib/actions/definitions.ts). Each one is a zod schema with its
 * label, unit and an LLM-friendly description attached as metadata, so the same field shows up identically in the
 * REST API's OpenAPI document, the MCP tool schemas and the web forms' validation messages.
 *
 * Client-safe: zod + viem utils only.
 */
import { getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Translate } from "@/lib/i18n/keys";

/** MockUSDT on anvil and BSC testnet: 6 decimals, symbol mUSDT. */
export const TOKEN = { symbol: "mUSDT", decimals: 6 } as const;

/** Chains with a KeyEscrow deployment (contracts/deployments/*.json). Never a mainnet. */
export const SUPPORTED_CHAIN_IDS = [31337, 97, 5611] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** Lease status names, index = RentalEscrow.Status. */
export const STATUS_NAMES = ["Created", "Active", "MoveOut", "Disputed", "Settled", "Cancelled"] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

/** Metadata keys we attach; `x-unit` lands in JSON Schema as-is. */
type Meta = { title: string; description: string; examples?: unknown[]; "x-unit"?: string };

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** "1,000.50" / 1000.5 -> "1000.50"; undefined when it is not a plain non-negative decimal. */
export function normalizeDecimal(v: string | number): string | undefined {
  const s = (typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v).trim().replace(/[,_\s]/g, "");
  return DECIMAL_RE.test(s) ? s : undefined;
}

/** Human token amount (e.g. "441.18") -> base units, or undefined if malformed / too many decimals. */
export function parseTokenAmount(v: string | number): bigint | undefined {
  const s = normalizeDecimal(v);
  if (s === undefined) return undefined;
  const frac = s.split(".")[1];
  if (frac && frac.length > TOKEN.decimals) return undefined;
  return parseUnits(s, TOKEN.decimals);
}

export const field = {
  /** Any EVM address; output is checksummed. */
  address: (meta: Meta) =>
    z
      .string()
      .trim()
      .refine((s) => isAddress(s, { strict: false }), "Not a valid address (0x followed by 40 hex characters).")
      .transform((s) => getAddress(s) as Address)
      .meta(meta),

  /** Token amount typed by a person ("441.18" or 441.18), in mUSDT; output is bigint base units. */
  tokenAmount: (meta: Meta, opts: { positive?: boolean } = {}) =>
    z
      .union([z.string(), z.number()])
      .transform((v, ctx) => {
        const units = parseTokenAmount(v);
        if (units === undefined) {
          ctx.addIssue({ code: "custom", message: `Enter an amount in ${TOKEN.symbol}, e.g. "441.18" (at most ${TOKEN.decimals} decimals).` });
          return z.NEVER;
        }
        if (opts.positive && units === BigInt(0)) {
          ctx.addIssue({ code: "custom", message: "Must be more than 0." });
          return z.NEVER;
        }
        return units;
      })
      .meta({ "x-unit": TOKEN.symbol, ...meta }),

  /** A decimal money amount in a currency chosen by a sibling field (THB, USD or mUSDT); output is the normalised string. */
  money: (meta: Meta) =>
    z
      .union([z.string(), z.number()])
      .transform((v, ctx) => {
        const s = normalizeDecimal(v);
        if (s === undefined || Number(s) <= 0) {
          ctx.addIssue({ code: "custom", message: 'Enter a positive amount, e.g. "18000" or "441.18".' });
          return z.NEVER;
        }
        return s;
      })
      .meta(meta),

  currency: (meta: Meta) => z.enum(["THB", "USD", "USDT"]).meta(meta),

  /** Whole number in a range; accepts "12" from query strings. */
  int: (min: number, max: number, meta: Meta) =>
    z.coerce
      .number({ message: "Enter a whole number." })
      .int("Enter a whole number.")
      .min(min, `${min} to ${max}.`)
      .max(max, `${min} to ${max}.`)
      .meta(meta),

  /** A 0x-prefixed 32-byte hex value (content hash); lowercased. */
  bytes32: (meta: Meta) =>
    z
      .string()
      .trim()
      .transform((s) => s.toLowerCase())
      .pipe(z.string().regex(/^0x[0-9a-f]{64}$/, "Must be 0x followed by 64 hex characters (a sha256 / keccak256 hash)."))
      .transform((s) => s as Hex)
      .meta(meta),

  text: (max: number, meta: Meta) => z.string().trim().min(1).max(max).meta(meta),

  chainId: () =>
    z
      .preprocess((v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v), z.union([z.literal(31337), z.literal(97)]))
      .optional()
      .meta({
        title: "Chain",
        description: "31337 = local anvil, 97 = BSC testnet. Defaults to the chain this server is configured for.",
      }),
};

/** Common inputs. */
export const leaseField = () =>
  field.address({ title: "Rental (escrow) address", description: "Address of the rental's RentalEscrow contract.", examples: ["0x…"] });

export const fromField = (who: string) =>
  field.address({
    title: "Signer address",
    description: `Wallet that will sign these transactions (${who}). Used to check permissions and to simulate; no key is needed.`,
  });

/** "441.18 mUSDT" */
export function formatToken(units: bigint): string {
  const neg = units < BigInt(0);
  const abs = neg ? -units : units;
  const base = BigInt(10) ** BigInt(TOKEN.decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(TOKEN.decimals, "0").replace(/0+$/, "");
  const cents = frac.length < 2 ? frac.padEnd(2, "0") : frac;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${cents} ${TOKEN.symbol}`;
}

/**
 * Validate one field of an action's input with that action's own schema (for the web forms).
 * Returns the first issue's message, or undefined when the value is valid.
 */
export function fieldError(schema: z.ZodObject, key: string, value: unknown): string | undefined {
  const f = schema.shape[key] as z.ZodType | undefined;
  if (!f) throw new Error(`no field ${key}`);
  const r = f.safeParse(value);
  return r.success ? undefined : r.error.issues[0]?.message;
}

/** fieldError for the web forms, in the active language (ui.field); the API and MCP tools keep the English. */
export function fieldErrorIn(t: Translate, schema: z.ZodObject, key: string, value: unknown): string | undefined {
  const msg = fieldError(schema, key, value);
  if (!msg || t.lang === "en") return msg;
  const range = /^(\d+) to (\d+)\.$/.exec(msg);
  if (range) return t("ui.field.range", { min: range[1], max: range[2] });
  if (msg.startsWith("Not a valid address")) return t("ui.field.address");
  if (msg.startsWith("Enter an amount in")) return t("ui.field.amount", { symbol: TOKEN.symbol, decimals: TOKEN.decimals });
  if (msg.startsWith("Enter a positive amount")) return t("ui.field.positive");
  if (msg === "Must be more than 0.") return t("ui.field.moreThan0");
  if (msg === "Enter a whole number.") return t("ui.field.whole");
  return msg;
}

/** The label of one field (from its metadata). */
export function fieldLabel(schema: z.ZodObject, key: string): string {
  let f = schema.shape[key] as z.ZodType | undefined;
  while (f && !f.meta()?.title && "unwrap" in f && typeof f.unwrap === "function") f = (f as z.ZodOptional).unwrap() as z.ZodType;
  return (f?.meta()?.title as string | undefined) ?? key;
}
