// Prisma 7 stopped loading .env by itself, and nothing here would see
// DATABASE_URL without this line. It must stay first: the datasource below
// reads process.env while this module is still evaluating.
import "dotenv/config";

import path from "node:path";

import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved CLI configuration out of schema.prisma. The connection URL in
 * particular is no longer allowed in the datasource block at all -- a `url`
 * there is now a P1012 validation error.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  migrations: {
    path: path.join("prisma", "migrations"),
  },

  datasource: {
    // Deliberately not prisma/config's env() helper, which throws when the
    // variable is absent. `prisma generate` connects to nothing, and it runs in
    // two places where no database exists and none is needed: npm ci's
    // postinstall in CI, and the Docker build stage. Commands that genuinely
    // need a connection report the missing URL themselves.
    url: process.env.DATABASE_URL,
  },
});
