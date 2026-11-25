import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // No real LLM, chain or storage calls: provider keys are unset and fetch only reaches 127.0.0.1.
    setupFiles: ["test/setup.ts"],
    // `pnpm coverage` (root).
    coverage: { provider: "v8", include: ["src/**/*.ts"], reporter: ["text-summary", "lcovonly"] },
  },
});
