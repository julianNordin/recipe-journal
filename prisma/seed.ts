import "dotenv/config";

import { createPrismaClient } from "../src/server/prisma";

import { DEMO_PASSWORD, seedDatabase } from "./seed-data";

/**
 * The seed as a script: build a client, run the fixture, say what happened.
 *
 * Everything with logic in it lives in ./seed-data.ts, which takes a client
 * and is therefore testable. This file is the part that cannot be -- it reads
 * the environment and exits a process.
 */
const db = createPrismaClient({ connectionString: process.env.DATABASE_URL ?? "" });

seedDatabase(db)
  .then(async (counts) => {
    console.log("seeded", counts);
    // Printed rather than left to be found in a file. Somebody who has just
    // cloned and seeded should be able to sign in from what the terminal said.
    console.log(`demo sign-in: ada@example.com or linus@example.com / ${DEMO_PASSWORD}`);
    await db.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
