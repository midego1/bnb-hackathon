import type { NextConfig } from "next";
import { assertSecretsPageBuildAllowed } from "./lib/secretsDeployGuard";

// The write-only secrets page is local-only: a Cloudflare build with SETTINGS_SECRETS_ENABLED=1 fails here.
assertSecretsPageBuildAllowed(process.env);

// Optional x402 payment modules referenced by @coinbase/cdp-sdk (pulled in via RainbowKit's
// Base Account connector). They are not installed and not used, so resolve them to an empty stub.
const unusedOptionalDeps = [
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
];

// The Cloudflare Workers build (scripts/cf.mjs, docs/CLOUDFLARE.md) is public: chain 97 only and never the anvil
// dev-account switcher. Checked here as well as in the wrapper, so no other way of building can skip it.
if (process.env.KEYESCROW_BUILD_TARGET === "cloudflare") {
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1") {
    throw new Error("Cloudflare build refused: NEXT_PUBLIC_DEV_ACCOUNTS=1 (the anvil dev accounts) must be off on a public build.");
  }
  if (process.env.NEXT_PUBLIC_CHAIN_ID !== "97") {
    throw new Error(`Cloudflare build refused: NEXT_PUBLIC_CHAIN_ID is "${process.env.NEXT_PUBLIC_CHAIN_ID ?? ""}", not 97 (BSC testnet).`);
  }
}

const cloudflare = process.env.KEYESCROW_BUILD_TARGET === "cloudflare";

// The secrets page and its API (local only): no referrer, never framed. Cache-Control is set by Next for the dynamic
// page and by the route handlers (lib/server/secrets/http.ts), which also run the request guard.
const SECRETS_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  async headers() {
    return ["/settings/secrets", "/settings/secrets/:path*", "/api/settings/:path*"].map((source) => ({ source, headers: SECRETS_HEADERS }));
  },
  // The judge's phone (/r/<slug>) and the item's listing (/app/listings/<slug>) are the stage page in another mode
  // (components/stage/Live.tsx): one page entry instead of three keeps the Worker under the 3 MiB Free limit.
  async rewrites() {
    return ["/r/:slug", "/app/listings/:slug"].map((source) => ({ source, destination: "/stage/:slug" }));
  },
  // The Playwright run builds into its own directory (with dev accounts on) so it never clobbers `next build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Always define the dev-accounts flag so Next inlines it and production bundles drop the anvil switcher
  // (an unset NEXT_PUBLIC_ var is left as a runtime lookup and nothing gets tree-shaken).
  env: { NEXT_PUBLIC_DEV_ACCOUNTS: process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" ? "1" : "0" },
  // Off on Cloudflare Workers: Cache Components' render staging relies on Node's setTimeout ordering, and under workerd
  // every page render hangs ("code had hung and would never generate a response"). Nothing here uses "use cache".
  cacheComponents: !cloudflare,
  partialPrefetching: !cloudflare,
  // Greenfield SDK (cosmjs/protobuf) is loaded lazily on the server only; keep it out of the bundle. The Workers build
  // stubs it instead (it would add ~5 MiB; evidence lives in R2 there).
  serverExternalPackages: cloudflare ? [] : ["@bnb-chain/greenfield-js-sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: {
      ...Object.fromEntries(unusedOptionalDeps.map((dep) => [dep, "./lib/stubs/empty.js"])),
      ...(cloudflare ? { "@bnb-chain/greenfield-js-sdk": "./lib/stubs/greenfield-unavailable.js" } : {}),
    },
  },
};

export default nextConfig;
