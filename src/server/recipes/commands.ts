import type { RecipeInput } from "@/domain/recipe-input";
import type { IngredientInput, StepInput } from "@/domain/recipe-lists";
import type { PrismaClient } from "@/generated/prisma/client";

import { nextAvailableSlug } from "./slugs";

/**
 * The writes. Queries live next door in `queries.ts`; both take their client
 * as an argument, for the reason that file explains at length.
 *
 * **These functions do not authorize anything, and that is deliberate.** They
 * are called from `src/app/studio/actions.ts`, which is where the session is
 * read and `requireRecipeAuthor` is called. Putting the check in both places
 * would mean two answers to keep in agreement; putting it only here would mean
 * a data layer that needs a request context to run, which is exactly what
 * makes a data layer untestable. The seam is the action, and Phase 14's
 * mutation test is the removal of one call in it.
 */

/**
 * A new draft, with its first slug, in one transaction.
 *
 * Both rows or neither. A recipe with no slug is reachable only from its
 * author's dashboard and has no public URL at all -- recoverable, but only
 * because the studio deliberately still lists it.
 *
 * Nothing here can publish. `status` and `publishedAt` are left to their
 * defaults, and moving them is a validated transition in `publish.ts` rather
 * than a field on a form.
 */
export async function createRecipe(
  db: PrismaClient,
  params: { authorId: string; input: RecipeInput },
): Promise<{ id: string; slug: string }> {
  const slug = await nextAvailableSlug(db, params.input.title);

  return db.$transaction(async (tx) => {
    const recipe = await tx.recipe.create({
      data: { ...params.input, authorId: params.authorId },
      select: { id: true },
    });

    await tx.recipeSlug.create({
      data: { slug, recipeId: recipe.id, isCurrent: true },
    });

    return { id: recipe.id, slug };
  });
}

/**
 * Overwrite a recipe's own fields.
 *
 * **The slug is not among them.** Renaming a recipe is Phase 15's, and it is a
 * larger question than it looks: the old URL has to keep resolving, so a
 * rename flips one slug row and inserts another inside a transaction, and
 * `/recipes/<old>` answers with a permanent redirect. Quietly repointing the
 * slug here would break every existing link with nothing behind it.
 *
 * The whole input is written, nulls included, so that emptying a field in the
 * form actually clears it. A partial update built from "the fields that have
 * values" can add a summary and can never take one away.
 */
export async function updateRecipe(
  db: PrismaClient,
  params: { id: string; input: RecipeInput },
): Promise<void> {
  await db.recipe.update({
    where: { id: params.id },
    data: params.input,
    select: { id: true },
  });
}

/**
 * Replace a recipe's ingredients and steps with the lists it was given.
 *
 * **A replace, not a diff, because the editor holds the whole list.** It posts
 * every row every time -- there is no partial update to reconcile -- and two
 * `deleteMany`s plus two `createMany`s cost four statements whatever the list
 * length. The obvious alternative, matching incoming rows to existing ones by
 * id and updating each, is a query per row: the N+1 this project spends Phase
 * 18 removing, introduced by hand.
 *
 * The cost is that row ids change on every save. Nothing references them --
 * no foreign key points at an ingredient or a step -- and the editor keys off
 * them only for the render it already has.
 *
 * **What this path does *not* do is create the transient duplicate position
 * the `DEFERRABLE INITIALLY DEFERRED` constraints exist for.** Everything is
 * deleted before anything is written, so no two rows ever share a position
 * mid-transaction. Those constraints still decide whether the final state is
 * legal, and Phase 06's reorder test is what proves they defer -- but it is
 * worth being straight that a replace does not need the deferral, and that an
 * in-place reorder is the shape that would.
 *
 * Scoped by `recipeId` in every statement. A `deleteMany` without it empties
 * the table, and every other test here would still pass.
 */
export async function replaceRecipeLists(
  db: PrismaClient,
  params: { recipeId: string; ingredients: IngredientInput[]; steps: StepInput[] },
): Promise<void> {
  const { recipeId, ingredients, steps } = params;

  await db.$transaction(async (tx) => {
    await tx.recipeIngredient.deleteMany({ where: { recipeId } });
    await tx.recipeStep.deleteMany({ where: { recipeId } });

    if (ingredients.length > 0) {
      await tx.recipeIngredient.createMany({
        data: ingredients.map((item) => ({ ...item, recipeId })),
      });
    }

    if (steps.length > 0) {
      await tx.recipeStep.createMany({ data: steps.map((step) => ({ ...step, recipeId })) });
    }
  });
}
