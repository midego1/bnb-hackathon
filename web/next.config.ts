import type { NextConfig } from "next";

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
