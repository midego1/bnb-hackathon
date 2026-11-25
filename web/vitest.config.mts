import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests must never reach real APIs: provider keys are blanked in tests/setup.ts.
    setupFiles: ["tests/setup.ts"],
    // `pnpm coverage` (root): unit-test coverage of the logic and API routes; pages and components are covered by e2e/.
    coverage: {
      provider: "v8",
      include: ["lib/**/*.{ts,tsx}", "app/api/**/*.ts"],
      reporter: ["text-summary", "lcovonly"],
    },
  },
});
