import "server-only";

import { env } from "@/env";
import type { PrismaClient } from "@/generated/prisma/client";

import { createPrismaClient } from "./prisma";

/*
 * The application's Prisma client, as a singleton.
 *
 * Next's dev server re-evaluates modules on every save. A bare
 * `new PrismaClient()` at module scope therefore opens a fresh connection pool
 * on every edit, and within a few minutes of working Postgres starts refusing
 * connections -- a failure that reads as a database problem and is not one.
 * Caching on globalThis survives the module reload.
 *
 * In production the module is evaluated once, so the cache is never read and
 * the client is created exactly as it would have been anyway.
 *
 * `server-only` makes importing this from a Client Component a build error
 * rather than a bundle that ships a database driver to a browser. That guard
 * also throws under plain Node, which is why the seed script and the database
 * test tier build their own client from ./prisma instead.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db: PrismaClient =
  globalForPrisma.prisma ??
  createPrismaClient({
    connectionString: env.DATABASE_URL,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
