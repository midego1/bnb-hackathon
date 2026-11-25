import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests must never reach real APIs: provider keys are blanked in tests/setup.ts.
    setupFiles: ["tests/setup.ts"],
  },
});
