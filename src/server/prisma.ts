import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Builds a Prisma client against a given connection string.
 *
 * Deliberately *not* marked `server-only`, and deliberately not a singleton.
 * Three callers need a client with three different lifecycles:
 *
 *   - the application, which wants one long-lived pool  -> ./db.ts
 *   - the seed script, which connects and exits
 *   - the database test tier, which points at a throwaway container
 *
 * The last two must be able to import this from plain Node, where the
 * `server-only` guard throws, and they should not share the application's
 * pool even when they could.
 */
export function createPrismaClient(options: {
  connectionString: string;
  log?: ("warn" | "error" | "query")[];
}): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.connectionString }),
    log: options.log ?? ["error"],
  });
}
