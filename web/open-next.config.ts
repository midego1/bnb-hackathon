import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * OpenNext for Cloudflare (see docs/CLOUDFLARE.md). Prerendered pages are read from the Worker's static assets
 * (read-only, no ISR revalidation; nothing here revalidates), so no R2 or KV cache is needed and the build stays on
 * the Workers Free plan. `buildCommand` routes every OpenNext build through scripts/cf.mjs, which pins chain 97 and
 * refuses a build with the anvil dev accounts switched on.
 */
const config = defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache });
config.buildCommand = "node scripts/cf.mjs next-build";

export default config;
