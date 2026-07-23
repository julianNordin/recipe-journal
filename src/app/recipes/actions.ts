"use server";

import { mayDeleteComment, parseCommentBody, type CommentProblem } from "@/domain/comment";
import { createComment, deleteComment } from "@/server/comments/commands";
import { findCommentContext } from "@/server/comments/queries";
import { db } from "@/server/db";
import { findCurrentSlug } from "@/server/recipes/queries";
import { revalidateRecipe } from "@/server/revalidate";
import { NotAuthorizedError, requireUser } from "@/server/session";

/**
 * The mutating Server Actions the public recipe pages need.
 *
 * A second `"use server"` module beside the studio's, and the split is along
 * the line that matters: **everything here is done by a reader, not by an
 * author.** The studio's actions all pass through `requireRecipeAuthor`;
 * neither of these can, because the whole point of a comment is that somebody
 * other than the author wrote it.
 *
 * Everything phase 14 established still applies, and applies harder. Each
 * export below is a public HTTP endpoint with a stable id, reachable by
 * anybody, with whatever body they choose -- and these two are reachable by
 * *any signed-in user* rather than by the handful of people with recipes. The
 * guard is the first thing in each of them and there is a replayed request in
 * `tests/e2e/authorization.spec.ts` for both.
 */

export type CommentFormState =
  | { status: "idle" }
  | { status: "posted" }
  | { status: "rejected"; problem: CommentProblem | "not-commentable" };

/**
 * Post a comment on a published recipe.
 *
 * `requireUser` rather than `requireRecipeAuthor`: any signed-in reader may
 * comment, and that is the difference between this file and the studio's. What
 * is *not* checked here is whether the recipe takes comments at all -- that
 * needs the database, so it lives in the command, which refuses a draft and a
 * recipe that is not there with the same answer.
 *
 * The author is taken from the session and never from the form. There is no
 * field for it, which is what makes "comment as somebody else" not a request
 * anybody can compose rather than a request that gets refused.
 */
export async function createCommentAction(
  _previous: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await requireUser();

  const recipeId = formData.get("recipeId");
  if (typeof recipeId !== "string" || recipeId === "") {
    throw new Error("createCommentAction called without a recipe id");
  }

  const parsed = parseCommentBody(formData.get("body"));
  if (!parsed.ok) return { status: "rejected", problem: parsed.problem };

  const result = await createComment(db, {
    recipeId,
    authorId: user.id,
    body: parsed.body,
    // The clock enters at the boundary, as it does for publishing. The rate
    // limit's window is a pure function of the moment it is handed.
    now: new Date(),
  });

  if (!result.ok) return { status: "rejected", problem: result.problem };

  // The comment renders on a page that is cached, so without this it is
  // invisible until something else happens to invalidate that page.
  revalidateRecipe({ slugs: [await findCurrentSlug(db, recipeId)] });

  return { status: "posted" };
}

/**
 * Remove a comment, if this person is allowed to.
 *
 * **The check is `mayDeleteComment`, the same function the component uses to
 * decide whether to draw the button.** That is the entire reason it is a pure
 * function in the domain layer: the button and the endpoint have to agree, and
 * a second implementation of the rule would eventually not.
 *
 * A comment that is not there and a comment that is not yours raise the same
 * error, for the reason `requireRecipeAuthor` does: telling them apart lets
 * somebody probe for which comment ids are real.
 */
export async function deleteCommentAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const commentId = formData.get("commentId");
  if (typeof commentId !== "string" || commentId === "") {
    throw new Error("deleteCommentAction called without a comment id");
  }

  const context = await findCommentContext(db, commentId);
  if (context === null) throw new NotAuthorizedError("That comment is not yours");

  if (!mayDeleteComment({ ...context, userId: user.id })) {
    throw new NotAuthorizedError("That comment is not yours");
  }

  await deleteComment(db, { id: commentId });

  revalidateRecipe({ slugs: [await findCurrentSlug(db, context.recipeId)] });
}
