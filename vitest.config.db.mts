import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The database tier: real Postgres in a throwaway container.
 *
 * Separate from the unit tier on purpose. This one needs Docker, which on the
 * development machine is frequently not running, and a fast tier that cannot
 * run without it stops being a fast tier.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "db",
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/setup/global-setup.ts"],
    // One container shared by every file, so the files must not run in
    // parallel against the same tables -- truncation between tests is only
    // safe if nothing else is mid-test.
    fileParallelism: false,
    // Pulling the image on a cold machine can take a while.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
