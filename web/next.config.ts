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

const nextConfig: NextConfig = {
  // The Playwright run builds into its own directory (with dev accounts on) so it never clobbers `next build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Always define the dev-accounts flag so Next inlines it and production bundles drop the anvil switcher
  // (an unset NEXT_PUBLIC_ var is left as a runtime lookup and nothing gets tree-shaken).
  env: { NEXT_PUBLIC_DEV_ACCOUNTS: process.env.NEXT_PUBLIC_DEV_ACCOUNTS === "1" ? "1" : "0" },
  cacheComponents: true,
  partialPrefetching: true,
  // Greenfield SDK (cosmjs/protobuf) is loaded lazily on the server only; keep it out of the bundle.
  serverExternalPackages: ["@bnb-chain/greenfield-js-sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: Object.fromEntries(unusedOptionalDeps.map((dep) => [dep, "./lib/stubs/empty.js"])),
  },
};

export default nextConfig;
