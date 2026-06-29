import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Read queries for recipes.
 *
 * This module is the only place in the application that talks to Prisma about
 * recipes. Pages compose and render; they do not write queries.
 *
 * Every function takes the client rather than importing the singleton, for one
 * concrete reason: the singleton is `server-only` and builds itself from
 * `env.DATABASE_URL`, so a test importing it would both throw under plain Node
 * and, if that were worked around, talk to the development database instead of
 * the throwaway container. Passing the client is what makes this layer
 * testable against real Postgres at all. Pages supply `db`; the database tier
 * supplies its container client.
 */

/** Published recipes only. Drafts are never counted here. */
export async function countPublishedRecipes(db: PrismaClient): Promise<number> {
  return db.recipe.count({ where: { status: "PUBLISHED" } });
}
