import path from "node:path";
import { defineConfig } from "vitest/config";

/** `pnpm stage:mainnet:rehearse`: scripts/*.rehearsal.ts against a local anvil (no tests/setup.ts: it blocks fetch). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { environment: "node", include: ["scripts/*.rehearsal.ts"], testTimeout: 180_000, hookTimeout: 180_000 },
});
