import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke test: `pnpm -C web test:e2e`.
 *
 * e2e/global-setup.ts starts a throwaway anvil on 127.0.0.1:28546 and deploys + seeds it with the M3 forge
 * scripts; the webServer below builds the app into .next-e2e with the anvil dev account switcher enabled
 * and serves it with `next start` on 127.0.0.1:3150. Nothing here touches any other node or port.
 */
export const E2E_RPC_PORT = Number(process.env.E2E_RPC_PORT ?? 28546);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3150);

const env = {
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_PUBLIC_RPC_URL: `http://127.0.0.1:${E2E_RPC_PORT}`,
  NEXT_PUBLIC_DEV_ACCOUNTS: "1",
  // Offline: deterministic mock inspector and price, evidence on local disk.
  VISION_LLM_PROVIDER: "mock",
  ANTHROPIC_API_KEY: "",
  CMC_API_KEY: "",
  ATLAS_RPC_URL: "",
  GREENFIELD_RPC_URL: "",
  EVIDENCE_DIR: "test-results/e2e-evidence",
  NEXT_TELEMETRY_DISABLED: "1",
};

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
    env,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
