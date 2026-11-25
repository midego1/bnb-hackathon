import { defineConfig, devices } from "@playwright/test";
import { E2E_WEB_ENV, E2E_WEB_PORT } from "./e2e/env";

/**
 * Browser smoke test: `pnpm -C web test:e2e`.
 *
 * e2e/global-setup.ts starts a throwaway anvil on 127.0.0.1:28546 and deploys + seeds it with the M3 forge
 * scripts; the webServer below builds the app into .next-e2e with the anvil dev account switcher enabled
 * and serves it with `next start` on 127.0.0.1:3150. Nothing here touches any other node or port.
 * The web server gets every NEXT_PUBLIC_* explicitly (e2e/env.ts), so a web/.env.local cannot leak into the build.
 */
// Ports and the full, hermetic web-server environment live in e2e/env.ts (see there for why).
export { E2E_RPC_PORT, E2E_WEB_PORT } from "./e2e/env";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/playwright",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -H 127.0.0.1 -p ${E2E_WEB_PORT}`,
    url: `http://127.0.0.1:${E2E_WEB_PORT}`,
    env: E2E_WEB_ENV,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
