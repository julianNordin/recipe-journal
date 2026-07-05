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

let seqScanClient: PrismaClient | undefined;

/**
 * A second client whose sessions may not use index or bitmap scans.
 *
 * For asserting that a query orders its own rows. Without this the assertion
 * is worthless, and not obviously so: the position columns are covered by the
 * unique indexes backing phase 06's deferrable constraints, so Postgres
 * happily answers `WHERE recipe_id = ?` with an index scan on
 * `(recipe_id, position)` and hands back position order having never been
 * asked for it. Measured: deleting both `orderBy` clauses from the detail
 * query changed the emitted SQL -- no ORDER BY at all -- and changed no test
 * result whatsoever.
 *
 * `enable_indexscan=off` costs the planner off that shortcut, so the rows
 * arrive in heap order and only a real ORDER BY can sort them. The test that
 * uses this carries a positive control asserting heap order really does
 * differ, because an adversarial fixture that stopped being adversarial would
 * otherwise fail silently.
 *
 * Session options travel in the connection string, so this needs its own
 * client -- but it is the same database as `testDb()`, so either may set data
 * up for the other.
 */
export function seqScanOnlyDb(): PrismaClient {
  if (seqScanClient === undefined) {
    const url = new URL(inject("databaseUrl"));
    url.searchParams.set("options", "-c enable_indexscan=off -c enable_bitmapscan=off");
    seqScanClient = createPrismaClient({ connectionString: url.toString() });
  }
  return seqScanClient;
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
    await seqScanClient?.$disconnect();
    seqScanClient = undefined;
  });

  return testDb;
}
