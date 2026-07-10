import { slugSearchPrefix, uniqueSlug } from "@/domain/slug";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Turning a title into a slug nobody already holds.
 *
 * The rule -- what a slug looks like, and how a collision is resolved -- is
 * pure and lives in `src/domain/slug.ts`. What lives here is the one thing it
 * cannot do: find out which slugs are taken.
 */

/**
 * A slug for `title` that no recipe currently holds.
 *
 * **Bounded by a prefix rather than reading the whole table.** Every candidate
 * `uniqueSlug` can return begins with `slugSearchPrefix(title)`, which is why
 * that function exists in the domain module instead of this query
 * reconstructing the truncation rule and getting it subtly wrong for long
 * titles.
 *
 * **The answer can be stale, and the primary key is what makes that safe.**
 * Two creates of the same title can both read before either writes, agree on
 * the same slug, and one of them then loses to `recipe_slugs`' primary key --
 * rolling its whole transaction back rather than leaving a recipe with no
 * slug. Serialising this properly is Phase 15's problem, where renames make
 * concurrent writes to the same rows an ordinary event rather than a
 * coincidence.
 */
export async function nextAvailableSlug(db: PrismaClient, title: string): Promise<string> {
  const taken = await db.recipeSlug.findMany({
    where: { slug: { startsWith: slugSearchPrefix(title) } },
    select: { slug: true },
  });

  // Every slug the recipe has ever had counts as taken, current or not. A
  // history row still owns its slug -- the primary key says so -- and reusing
  // one would point an old URL at a different recipe.
  return uniqueSlug(
    title,
    taken.map((row) => row.slug),
  );
}
