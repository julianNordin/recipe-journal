import { execSync } from "node:child_process";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

/**
 * One Postgres container for the whole database tier.
 *
 * Per-file containers would be correct and unusably slow -- starting Postgres
 * costs seconds and there are many files. One container plus per-test
 * truncation is the trade every project of this shape makes; P8 measured
 * truncation at 8 ms against 1862 ms for a schema drop and re-migrate.
 *
 * The image is pinned to the same major the application runs in compose. A
 * test tier on a different Postgres than production is testing the wrong
 * database, and the constraints this project leans on are version-sensitive.
 */

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("recipe_journal_test")
    .withUsername("test")
    .withPassword("test")
    // The default wait strategy returns when the port is open, which is before
    // the server accepts queries.
    .start();

  const url = container.getConnectionUri();

  // migrate deploy, not db push: push reconciles the database to the schema
  // file and would silently skip every hand-written constraint in the
  // migration SQL, which is precisely what this tier exists to test.
  // execSync with a single literal string rather than execFileSync with an
  // args array and shell:true -- Node 24 deprecates that combination (DEP0190)
  // because the arguments are concatenated unescaped. Nothing here is
  // interpolated, so a fixed command string is both safe and quiet.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  project.provide("databaseUrl", url);
}

export async function teardown() {
  await container?.stop();
}

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
