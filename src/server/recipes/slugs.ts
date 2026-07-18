import { slugSearchPrefix, uniqueSlug } from "@/domain/slug";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Turning a title into a slug nobody already holds, and moving a recipe's
 * current slug when its title changes.
 *
 * The rule -- what a slug looks like, and how a collision is resolved -- is
 * pure and lives in `src/domain/slug.ts`. What lives here is the two things it
 * cannot do: find out which slugs are taken, and write the row that says which
 * one is live.
 *
 * **Both functions take `Prisma.TransactionClient` rather than
 * `PrismaClient`.** That is the wider of the two, not the narrower: a full
 * client satisfies it, so a caller may hand over either the singleton or an
 * open transaction. A rename has to be atomic with the title change that
 * caused it, and typing these against the client would have meant either a
 * duplicate implementation or a rename that can half-happen.
 */

/**
 * A slug for `title` that no *other* recipe currently holds.
 *
 * **Bounded by a prefix rather than reading the whole table.** Every candidate
 * `uniqueSlug` can return begins with `slugSearchPrefix(title)`, which is why
 * that function exists in the domain module instead of this query
 * reconstructing the truncation rule and getting it subtly wrong for long
 * titles.
 *
 * `exceptRecipeId` is what makes a rename possible at all. Without it a recipe
 * collides with itself -- its own current slug is "taken", so re-saving a form
 * with an unchanged title would hand back `title-2` -- and, worse, a recipe
 * renamed away and back could never reclaim the slug sitting in its own
 * history. With it, the answer may be a slug this recipe already owns, and the
 * caller reuses that row instead of writing a new one.
 *
 * **The answer can be stale, and the primary key is what makes that safe.**
 * Two writers can read before either commits, agree on the same slug, and one
 * of them then loses to `recipe_slugs`' primary key -- rolling its whole
 * transaction back rather than leaving a recipe with no slug.
 */
export async function nextAvailableSlug(
  db: Prisma.TransactionClient,
  title: string,
  options: { exceptRecipeId?: string } = {},
): Promise<string> {
  const taken = await db.recipeSlug.findMany({
    where: {
      slug: { startsWith: slugSearchPrefix(title) },
      ...(options.exceptRecipeId === undefined
        ? {}
        : { recipeId: { not: options.exceptRecipeId } }),
    },
    select: { slug: true },
  });

  // Every slug another recipe has ever had counts as taken, current or not. A
  // history row still owns its slug -- the primary key says so -- and reusing
  // one would point an old URL at a different recipe.
  return uniqueSlug(
    title,
    taken.map((row) => row.slug),
  );
}

/**
 * What a rename did, or did not do.
 *
 * `previous` is the address the recipe held before this call, and it is here
 * for one caller: the Server Action, which has to invalidate the cached
 * response for **both** addresses. Invalidating only the new one leaves the
 * old URL serving the recipe instead of redirecting to it -- correct database,
 * correct redirect, wrong answer, and nothing anywhere reports a problem.
 */
export type SlugMove = { slug: string; previous: string | null; moved: boolean };

/**
 * Point a recipe's live slug at its title, keeping the old address working.
 *
 * **What happens to the old row depends on whether the recipe was ever
 * public**, and `publishedAt` is exactly the record of that -- it is set on the
 * first publish and never cleared, so it outlives an unpublish. That is what
 * makes it the right thing to ask here rather than `status`:
 *
 * - **Ever published** -- the old row stays, with `is_current = false`. Someone
 *   has that URL. `/recipes/<old>` finds the row and redirects.
 * - **Never published** -- the old row is deleted. No URL that ever worked is
 *   being broken, and keeping it would reserve a slug nobody has seen, forever,
 *   every time an author reworded a draft title.
 *
 * The order inside is the part that has to be right: the live row is cleared
 * *before* the new one is written, so `ux_recipe_slug_current` -- the partial
 * unique index that makes "exactly one live slug per recipe" a fact rather than
 * a convention -- is never momentarily false. It is a plain index and cannot be
 * deferred, so there is no window to be sloppy in.
 *
 * The write is an upsert because the target may be a row this recipe already
 * owns: renaming away and back reclaims the original address rather than
 * minting `title-2`. If a concurrent writer took that slug in between, the
 * update lands on somebody else's row and the same index refuses the result --
 * which is the outcome to want, and there is a test that races two renames to
 * show it happening.
 */
export async function moveCurrentSlug(
  db: Prisma.TransactionClient,
  params: { recipeId: string; title: string },
): Promise<SlugMove> {
  const current = await db.recipeSlug.findFirst({
    where: { recipeId: params.recipeId, isCurrent: true },
    select: { slug: true },
  });

  const desired = await nextAvailableSlug(db, params.title, { exceptRecipeId: params.recipeId });
  const previous = current?.slug ?? null;

  if (previous === desired) return { slug: desired, previous, moved: false };

  if (current !== null) {
    const recipe = await db.recipe.findUniqueOrThrow({
      where: { id: params.recipeId },
      select: { publishedAt: true },
    });

    if (recipe.publishedAt === null) {
      await db.recipeSlug.delete({ where: { slug: current.slug } });
    } else {
      await db.recipeSlug.update({
        where: { slug: current.slug },
        data: { isCurrent: false },
      });
    }
  }

  await db.recipeSlug.upsert({
    where: { slug: desired },
    update: { isCurrent: true },
    create: { slug: desired, recipeId: params.recipeId, isCurrent: true },
  });

  return { slug: desired, previous, moved: true };
}
