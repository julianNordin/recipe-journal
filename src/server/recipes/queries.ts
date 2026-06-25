import "server-only";

import { db } from "@/server/db";

/**
 * Read queries for recipes.
 *
 * This module is the only place in the application that talks to Prisma about
 * recipes. Pages compose and render; they do not import `db`. That boundary is
 * what makes the data layer testable against a real database without a browser,
 * and it is what stops a page from growing a query nobody can find later.
 */

/** Published recipes only, newest first. Drafts are never visible here. */
export async function countPublishedRecipes(): Promise<number> {
  return db.recipe.count({ where: { status: "PUBLISHED" } });
}
