import { afterAll, beforeEach, inject } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/server/prisma";

/**
 * A client against the shared test container, plus a clean table set before
 * every test.
 *
 * Truncation rather than a migrate reset: reset drops and replays the whole
 * migration history, which is roughly two orders of magnitude slower and, in
 * Prisma 7, refuses to run for an agent at all.
 *
 * RESTART IDENTITY CASCADE in one statement, so foreign keys never have to be
 * satisfied in a particular order and no test depends on delete ordering.
 */

let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  client ??= createPrismaClient({ connectionString: inject("databaseUrl") });
  return client;
}

/**
 * Every table except Prisma's own migration ledger, read from the catalogue
 * rather than listed by hand -- a hard-coded list silently stops truncating
 * whatever gets added next, and the symptom is a test that passes alone and
 * fails in a suite.
 */
async function tableNames(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  return rows.map((r) => r.tablename);
}

export async function truncateAll(db: PrismaClient): Promise<void> {
  const tables = await tableNames(db);
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Call at the top of any database test file.
 *
 * Deliberately not named use*: ESLint reads that prefix as a React hook and
 * rejects a call at module scope, which this is. It is a Vitest fixture.
 */
export function cleanDatabasePerTest(): () => PrismaClient {
  beforeEach(async () => {
    await truncateAll(testDb());
  });

  afterAll(async () => {
    await client?.$disconnect();
    client = undefined;
  });

  return testDb;
}
