import { publish, unpublish, type PublishableRecipe, type PublishProblem } from "@/domain/publish";
import type { RecipeInput } from "@/domain/recipe-input";
import type { IngredientInput, StepInput } from "@/domain/recipe-lists";
import type { PrismaClient } from "@/generated/prisma/client";

import { moveCurrentSlug, nextAvailableSlug, type SlugMove } from "./slugs";

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
 * Overwrite a recipe's own fields, and move its address if the title moved.
 *
 * **One transaction, because a title and its slug are one fact.** A rename
 * that half-happened would leave a recipe answering at an address that no
 * longer describes it, or -- worse -- leave the old address pointing at a row
 * whose `is_current` says it is not the live one. Both are silent.
 *
 * `moveCurrentSlug` decides whether anything needs to move at all, so an edit
 * that does not touch the title costs one extra read and writes nothing.
 *
 * The whole input is written, nulls included, so that emptying a field in the
 * form actually clears it. A partial update built from "the fields that have
 * values" can add a summary and can never take one away.
 */
export async function updateRecipe(
  db: PrismaClient,
  params: { id: string; input: RecipeInput },
): Promise<SlugMove> {
  return db.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id: params.id },
      data: params.input,
      select: { id: true },
    });

    return moveCurrentSlug(tx, { recipeId: params.id, title: params.input.title });
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

/**
 * What a publish attempt answers.
 *
 * Narrower than the domain's `PublishOutcome`, deliberately. That type carries
 * the resulting `publishedAt`, computed from the recipe as it was read -- and
 * the write below does not necessarily use it, because "set once" is decided
 * by the database rather than by that read. Handing a caller a date that might
 * not be the stored one is the kind of nearly-right value that is believed for
 * a long time.
 */
export type PublishResult = { ok: true } | { ok: false; problems: PublishProblem[] };

/** The fields the publish rules need, and the two counts they cannot see without asking. */
async function publishableRecipe(db: PrismaClient, id: string): Promise<PublishableRecipe> {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      title: true,
      summary: true,
      body: true,
      publishedAt: true,
      _count: { select: { ingredients: true, steps: true } },
    },
  });

  return {
    status: recipe.status,
    title: recipe.title,
    summary: recipe.summary,
    body: recipe.body,
    publishedAt: recipe.publishedAt,
    ingredientCount: recipe._count.ingredients,
    stepCount: recipe._count.steps,
  };
}

/**
 * Publish a recipe, if the rules in `src/domain/publish.ts` allow it.
 *
 * `findUniqueOrThrow` because the action has already been through
 * `requireRecipeAuthor(id)`, which established that this recipe exists and is
 * the caller's. A null here would mean it was deleted in between, and raising
 * is the right answer to that.
 *
 * **Two statements, and their order is not a style choice.** The date is
 * written first, conditionally, and only then does the status move:
 *
 *   1. `updateMany` where `publishedAt IS NULL` -- so "set once and never
 *      moved" is a condition the database evaluates, not a value computed from
 *      a read that may already be stale. Two publishes racing cannot shift the
 *      date between them.
 *   2. `update` the status.
 *
 * Reversing them fails. `ck_recipes_published_has_date` requires a published recipe to
 * carry a date, CHECK constraints are evaluated per statement, and setting the
 * status first leaves exactly the state it forbids. Measured -- swapping the
 * two raises the constraint violation on the first publish of any draft.
 */
export async function publishRecipe(
  db: PrismaClient,
  params: { id: string; now: Date },
): Promise<PublishResult> {
  const outcome = publish(await publishableRecipe(db, params.id), params.now);
  if (!outcome.ok) return { ok: false, problems: outcome.problems };

  await db.$transaction([
    db.recipe.updateMany({
      where: { id: params.id, publishedAt: null },
      data: { publishedAt: params.now },
    }),
    db.recipe.update({
      where: { id: params.id },
      data: { status: "PUBLISHED" },
      select: { id: true },
    }),
  ]);

  return { ok: true };
}

/**
 * Return a recipe to draft, keeping the date it was first published on.
 *
 * The read looks wasteful -- `status: "DRAFT"` is the only column that changes
 * -- and it is there on purpose. `unpublish` is where the rule that the date
 * survives is written down, and routing the write through it means changing
 * that function changes what the application does. A command that simply did
 * not mention the column would keep the date by accident, and the domain
 * module would be decoration.
 */
export async function unpublishRecipe(db: PrismaClient, params: { id: string }): Promise<void> {
  const recipe = await publishableRecipe(db, params.id);

  await db.recipe.update({
    where: { id: params.id },
    data: unpublish(recipe),
    select: { id: true },
  });
}
