"use server";

import { redirect } from "next/navigation";

import { parseRecipeInput, type RecipeFieldErrors } from "@/domain/recipe-input";
import { parseRecipeListsJson, type RecipeListsErrors } from "@/domain/recipe-lists";
import { db } from "@/server/db";
import { createRecipe, replaceRecipeLists, updateRecipe } from "@/server/recipes/commands";
import { requireRecipeAuthor, requireUser } from "@/server/session";

/**
 * Every mutating Server Action in the application, in one file.
 *
 * **`"use server"` publishes an HTTP endpoint.** Not "behaves a bit like one":
 * each export below is reachable at a stable id, by anyone, with whatever body
 * they choose to send. It does not look like a route handler, it has no
 * visible URL, and nothing about calling it from a component hints that a
 * stranger can call it too. That is the single most important thing to know
 * about this file, and the reason all of them live together where the guards
 * can be read at a glance.
 *
 * The shape every action follows:
 *
 *   1. establish who is asking **and what they are allowed to touch**,
 *      through `src/server/session.ts` and nowhere else -- one seam, so the
 *      guard is one change and its removal is one mutation test
 *   2. parse the body with the schema the form was built from
 *   3. call a command in `src/server/recipes/`, which does the writing and
 *      authorizes nothing
 *
 * Authorization comes before parsing, so a caller with no claim to the recipe
 * is refused without this server doing any work on the rest of their input.
 */

/**
 * What `useActionState` carries back into the form.
 *
 * A union rather than a bag of optional fields: "saved" and "invalid" are
 * different answers, and a form that had to infer which one it got from
 * whether an errors object was empty would eventually get it wrong.
 */
export type RecipeFormState =
  { status: "idle" } | { status: "saved" } | { status: "invalid"; errors: RecipeFieldErrors };

/*
 * No `const IDLE_FORM_STATE` here, and it is not a style choice: **a
 * "use server" module may export nothing but async functions.** Every export
 * becomes a callable endpoint, so a plain object is a build error --
 * `A "use server" file can only export async functions, found object` -- and
 * it is reported against the last line of the file rather than the export that
 * caused it. The type above survives only because types are erased before any
 * of that happens.
 */

/**
 * Create a draft and go to its editor.
 *
 * `requireUser` throws rather than returning an error for the form to render,
 * and that is the right shape: "you are not signed in" is not something wrong
 * with the submission. The studio is behind a session on every surface that
 * reaches it, so a caller who gets here without one did not come from the
 * form.
 *
 * The redirect goes to the editor rather than back to the dashboard. Creating
 * a recipe is the first half of writing one, and Phase 13 puts the ingredient
 * and step editor on that page.
 */
export async function createRecipeAction(
  _previous: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const user = await requireUser();

  const parsed = parseRecipeInput(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

  const recipe = await createRecipe(db, { authorId: user.id, input: parsed.value });

  /*
   * Nothing is revalidated here, deliberately.
   *
   * A new recipe is a draft, so no public page can be stale because of it --
   * and the dashboard it lands next to is dynamic. The interesting case is the
   * one this does *not* cover: editing a recipe that is already published,
   * whose public page was rendered once at build. That staleness is real, it
   * is what Phase 16 exists to show before fixing, and papering over it here
   * would delete the demonstration.
   */
  redirect(`/studio/${recipe.id}/edit`);
}

/**
 * Save an edit to an existing recipe.
 *
 * **`requireRecipeAuthor`, not `requireUser`, and that difference is the whole
 * of this project's security story.** Authentication establishes that
 * *somebody* is signed in. It says nothing about whose recipe the `id` in this
 * form names -- and that id arrives in a plain hidden input, written by
 * whoever sent the request.
 *
 * This action shipped without the check for two phases on purpose, so that the
 * hole could be watched rather than described. A request captured from Ada's
 * editor and sent again with Linus's cookies answered `{"status":"saved"}` and
 * left his text in her draft. `tests/e2e/authorization.spec.ts` is that replay,
 * and it fails again the moment the line below is removed.
 *
 * Nothing about the interface was wrong, which is the part worth keeping. The
 * editor page reads through `findAuthoredRecipe`, scoped by author, so no form
 * this application renders can be made to carry somebody else's id. That is
 * exactly why the endpoint has to check anyway: the replayed request never
 * went near the page that would have refused to render.
 */
export async function updateRecipeAction(
  _previous: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id === "") {
    // Read before the session, because authorization cannot be attempted
    // without it. Not a field error: no form this application renders can
    // produce this, so a caller who manages it did not come from one.
    throw new Error("updateRecipeAction called without a recipe id");
  }

  await requireRecipeAuthor(id);

  const parsed = parseRecipeInput(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

  await updateRecipe(db, { id, input: parsed.value });

  /*
   * Again, nothing is revalidated -- and here it genuinely matters. Editing a
   * recipe that is already published leaves `/recipes/<slug>` serving the HTML
   * it was built with, because that route is prerendered. The staleness is
   * real and visible, and it is the bug Phase 16 opens by demonstrating rather
   * than describing.
   */
  return { status: "saved" };
}

/** What the list editor carries back. Its own union: different failures. */
export type RecipeListsFormState =
  { status: "idle" } | { status: "saved" } | { status: "invalid"; errors: RecipeListsErrors };

/**
 * Save a recipe's ingredients and steps.
 *
 * A second action rather than a second half of `updateRecipeAction`, because
 * the two submissions have nothing in common: one is a flat set of fields, the
 * other two ordered lists posted as JSON. Folding them together would mean one
 * handler reconciling both shapes and one button that saves things the author
 * did not touch.
 *
 * **A second export is a second endpoint, and it needed its own guard.** This
 * one carried the identical hole and was the easier of the two to overlook: a
 * second save on the same page, doing work that looks like part of the first.
 * Every `"use server"` export is published separately and authorized
 * separately, or it is not authorized at all. The replay in
 * `tests/e2e/authorization.spec.ts` covers both for that reason.
 */
export async function saveRecipeListsAction(
  _previous: RecipeListsFormState,
  formData: FormData,
): Promise<RecipeListsFormState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id === "") {
    throw new Error("saveRecipeListsAction called without a recipe id");
  }

  await requireRecipeAuthor(id);

  const parsed = parseRecipeListsJson(formData.get("lists"));
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

  await replaceRecipeLists(db, {
    recipeId: id,
    ingredients: parsed.value.ingredients,
    steps: parsed.value.steps,
  });

  // No revalidation here either -- see the note in `updateRecipeAction`.
  return { status: "saved" };
}
