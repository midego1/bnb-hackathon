/**
 * The allowlist of the write-only secrets page (/settings/secrets). Only these names can be written, and each one
 * goes to the file(s) that actually read it:
 *
 *   root  the repo-root .env of the main checkout: Foundry scripts (contracts/script/testnet.sh), `pnpm agent:register`
 *         and the live demo runner on :3001 (DEMO_TESTNET_ENV_FILE).
 *   web   web/.env.local of the main checkout: the Next server (keyescrow-web on :3000 with `next dev`, and
 *         keyescrow-web-testnet on :3001 with `next start`, both run from that web/ directory).
 *
 * NEXT_PUBLIC_* names are inlined into the browser bundle at build time, so only a public value marked `public: true`
 * may be listed (the WalletConnect project id): never a secret.
 */

export type SecretTarget = "root" | "web";
/** Shown in this order; the labels (en + zh) are secrets.groups.* in the i18n dictionaries. */
export type SecretGroup = "prices" | "wallet" | "rpc" | "storage" | "sponsors" | "ai" | "deploy";

/** Cheap per-name format checks. Every value also has to pass the shared charset and length rules (envFile.ts). */
export type SecretFormat = "token" | "privateKey" | "jwt" | "url" | "uuid" | "digits" | "bucket" | "hex32" | "cmc" | "anthropic" | "cournot" | "cournotBase";

export type SecretSpec = {
  name: string;
  group: SecretGroup;
  /** What it is for, in one line. */
  purpose: string;
  /** Where to get it. */
  source: { label: string; url?: string };
  targets: SecretTarget[];
  format: SecretFormat;
  maxLength?: number;
  /** Extra readers outside the restartable units (shown as a note), e.g. a script that reads the file on each run. */
  note?: string;
  /** A public NEXT_PUBLIC_* value: baked into the browser bundle, so it needs a rebuild instead of a restart. */
  public?: true;
};

export const SECRETS: SecretSpec[] = [
  {
    name: "CMC_API_KEY",
    group: "prices",
    purpose: "CoinMarketCap Pro API: live USDT/BNB/THB prices and the volatility buffer on the deposit.",
    source: { label: "CoinMarketCap Pro (free Basic plan)", url: "https://pro.coinmarketcap.com/signup" },
    targets: ["web"],
    format: "cmc",
  },
  {
    name: "ATLAS_RPC_URL",
    group: "prices",
    purpose: "RPC the server reads the Atlas on-chain price feeds from (the URL may carry a provider key).",
    source: { label: "Your BSC testnet RPC provider" },
    targets: ["web"],
    format: "url",
  },
  {
    name: "ATLAS_API_KEY",
    group: "prices",
    purpose: "Atlas Pull API (api.atlasoracle.io): signed price reports for BNB/USD and USDT/USD, verified on-chain. Server-side only.",
    source: { label: "Atlas Oracle (hackathon key from the Atlas team, or atlasoracle.io)", url: "https://atlasoracle.io/pricing" },
    targets: ["web"],
    format: "token",
  },
  {
    name: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    group: "wallet",
    purpose: "WalletConnect project id: RainbowKit's full wallet list (mobile wallets by QR). Public, not a secret; injected wallets only without it.",
    source: { label: "Reown (WalletConnect) Cloud → Projects", url: "https://cloud.reown.com" },
    targets: ["web"],
    format: "hex32",
    public: true,
  },
  {
    name: "BSC_TESTNET_RPC_URL",
    group: "rpc",
    purpose: "BSC testnet RPC for deploys, verification and the live demo runner's transactions.",
    source: { label: "Any BSC testnet RPC (PublicNode, NodeReal, Ankr ...)" },
    targets: ["root"],
    format: "url",
    note: "Foundry scripts (pnpm deploy:testnet*) read the root .env on each run.",
  },
  {
    name: "BSC_MAINNET_RPC_URL",
    group: "rpc",
    purpose: "BSC mainnet RPC for the guarded mainnet deploy (contracts/script/testnet.sh 56).",
    source: { label: "Any BSC mainnet RPC (PublicNode, NodeReal, Ankr ...)" },
    targets: ["root"],
    format: "url",
    note: "Read by pnpm deploy:mainnet on its next run; no service restart.",
  },
  {
    name: "PINATA_JWT",
    group: "storage",
    purpose: "Pinata IPFS JWT. Not read by the app yet: noted for the IPFS evidence option.",
    source: { label: "Pinata → API keys", url: "https://app.pinata.cloud/developers/api-keys" },
    targets: ["web"],
    format: "jwt",
    maxLength: 4096,
  },
  {
    name: "GREENFIELD_RPC_URL",
    group: "storage",
    purpose: "BNB Greenfield RPC for storing the move-in/return photos (local folder without the four Greenfield values).",
    source: { label: "BNB Greenfield docs", url: "https://docs.bnbchain.org/bnb-greenfield/" },
    targets: ["web"],
    format: "url",
  },
  {
    name: "GREENFIELD_CHAIN_ID",
    group: "storage",
    purpose: "Greenfield chain id (5600 on testnet).",
    source: { label: "BNB Greenfield docs", url: "https://docs.bnbchain.org/bnb-greenfield/" },
    targets: ["web"],
    format: "digits",
  },
  {
    name: "GREENFIELD_BUCKET",
    group: "storage",
    purpose: "Bucket the inspection photos go into.",
    source: { label: "DCellar (Greenfield console)", url: "https://testnet.dcellar.io" },
    targets: ["web"],
    format: "bucket",
  },
  {
    name: "GREENFIELD_PRIVATE_KEY",
    group: "storage",
    purpose: "Testnet key of the Greenfield account that owns the bucket.",
    source: { label: "The wallet you created the bucket with" },
    targets: ["web"],
    format: "privateKey",
  },
  {
    name: "GREENFIELD_SP_ENDPOINT",
    group: "storage",
    purpose: "Optional storage-provider endpoint override.",
    source: { label: "BNB Greenfield docs", url: "https://docs.bnbchain.org/bnb-greenfield/" },
    targets: ["web"],
    format: "url",
  },
  {
    name: "COURNOT_API_KEY",
    group: "sponsors",
    purpose: "Optional prepaid Cournot key (ck_live_...) for more than the 3 free probability calls.",
    source: { label: "Cournot Intelligence Oracle", url: "https://interface.cournot.ai" },
    targets: ["web"],
    format: "cournot",
  },
  {
    name: "COURNOT_API_BASE",
    group: "sponsors",
    purpose: "Optional Cournot API base: https://interface.cournot.ai (the default when empty) or https://dev-interface.cournot.ai.",
    source: { label: "Cournot skill client", url: "https://github.com/Cournot-AI/cournot-skills" },
    targets: ["web"],
    format: "cournotBase",
  },
  {
    name: "LIVING_BRAIN_API_KEY",
    group: "sponsors",
    purpose: "Living Brain: the inspector's per-scooter memory of earlier damage (local file without it).",
    source: { label: "Living Brain dashboard", url: "https://docs.livingbrain.com" },
    targets: ["web"],
    format: "token",
  },
  {
    name: "LIVING_BRAIN_SUBJECT_ID",
    group: "sponsors",
    purpose: "Any UUID you pick: the subject the scooter memories are stored under.",
    source: { label: "Any UUID (uuidgen)" },
    targets: ["web"],
    format: "uuid",
  },
  {
    name: "LIVING_BRAIN_BRAIN_ID",
    group: "sponsors",
    purpose: "Brain id returned by POST /v1/brains (see the README).",
    source: { label: "Living Brain API", url: "https://docs.livingbrain.com" },
    targets: ["web"],
    format: "token",
  },
  {
    name: "ANTHROPIC_API_KEY",
    group: "ai",
    purpose: "Claude: the vision model that compares the scooter's pick-up and return photos, and Ask AI (mock verdicts and a demo model without it).",
    source: { label: "Anthropic Console → API keys", url: "https://console.anthropic.com/settings/keys" },
    targets: ["web"],
    format: "anthropic",
    note: "The agent server (pnpm agent:dev) reads its shell env only: export it there as well.",
  },
  {
    name: "INSPECTOR_PRIVATE_KEY",
    group: "ai",
    purpose: "Testnet key the KeyScrow Inspector agent signs its settlement reports with (unsigned without it).",
    source: { label: "A fresh testnet wallet (cast wallet new), see docs/AGENT.md" },
    targets: ["web", "root"],
    format: "privateKey",
    note: "Root .env copy is read by pnpm agent:register on its next run.",
  },
  {
    name: "BSCSCAN_API_KEY",
    group: "deploy",
    purpose: "Etherscan API V2 key used to verify the contracts on BscScan testnet.",
    source: { label: "Etherscan → API keys", url: "https://etherscan.io/myapikey" },
    targets: ["root"],
    format: "token",
    note: "Read by pnpm deploy:testnet:verify on its next run; no service restart.",
  },
  {
    name: "CLOUDFLARE_API_TOKEN",
    group: "deploy",
    purpose: "Cloudflare API token for the public deploy (wrangler). Not read by the app.",
    source: { label: "Cloudflare → My Profile → API Tokens", url: "https://dash.cloudflare.com/profile/api-tokens" },
    targets: ["root"],
    format: "token",
    note: "Used by deploy commands only; no service restart.",
  },
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    group: "deploy",
    purpose: "Cloudflare account id for the public deploy.",
    source: { label: "Cloudflare dashboard → Workers & Pages (right column)", url: "https://dash.cloudflare.com" },
    targets: ["root"],
    format: "hex32",
    note: "Used by deploy commands only; no service restart.",
  },
];

/** The systemd user units the page may restart, and nothing else. */
export const UNITS = {
  "keyescrow-web": { label: "web :3000", reads: ["web"] as SecretTarget[] },
  "keyescrow-web-testnet": { label: "testnet web :3001", reads: ["web", "root"] as SecretTarget[] },
} as const;
export type UnitName = keyof typeof UNITS;
export const UNIT_NAMES = Object.keys(UNITS) as UnitName[];

/**
 * Units that need a restart to pick up a new value of `spec`. web/.env.local is read by both web units; of the root
 * .env only BSC_TESTNET_RPC_URL reaches a unit (the live demo runner on :3001), everything else there is read by
 * scripts on their next run.
 */
export function restartUnits(spec: SecretSpec): UnitName[] {
  if (spec.public) return []; // a rebuild, not a restart (the UI says so)
  const units = new Set<UnitName>();
  if (spec.targets.includes("web")) units.add("keyescrow-web").add("keyescrow-web-testnet");
  if (spec.targets.includes("root") && spec.name === "BSC_TESTNET_RPC_URL") units.add("keyescrow-web-testnet");
  return UNIT_NAMES.filter((u) => units.has(u));
}

const BY_NAME = new Map(SECRETS.map((s) => [s.name, s]));

/** The spec of an allowlisted name, or undefined. NEXT_PUBLIC_* is refused unless its spec is marked public. */
export function secretSpec(name: unknown): SecretSpec | undefined {
  if (typeof name !== "string") return undefined;
  const spec = BY_NAME.get(name);
  return spec && (spec.public || !name.startsWith("NEXT_PUBLIC_")) ? spec : undefined;
}
