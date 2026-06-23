import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The unit tier: pure TypeScript, no Docker, no database, no browser.
 *
 * Phase 05 adds a second project for tests that need real Postgres through
 * Testcontainers. Keeping them separate is the point -- this tier has to stay
 * runnable anywhere, including on a machine with Docker Desktop shut down,
 * which on this one is most of the time.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "unit",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Excluded so that adding the database tier later cannot silently drag
    // Testcontainers into the fast tier.
    exclude: ["**/node_modules/**", "**/.next/**", "tests/db/**", "tests/e2e/**"],
  },
});
