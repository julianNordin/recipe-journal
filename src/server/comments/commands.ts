import { COMMENT_RATE_LIMIT, rateLimitWindowStart, type CommentProblem } from "@/domain/comment";
import type { PrismaClient } from "@/generated/prisma/client";

import { countCommentsSince } from "./queries";

/**
 * Writes for comments.
 *
 * Like the recipe commands, these authorize nothing: the session is read in
 * the Server Action and the answer is enforced there, on the one seam every
 * mutation passes through. What they *do* enforce is the two rules that need
 * the database to answer -- whether the recipe is open for comment at all, and
 * whether this person has posted too many too quickly.
 */

export type CreateCommentResult =
  | { ok: true; id: string }
  | { ok: false; problem: Extract<CommentProblem, "rate-limited"> | "not-commentable" };

/**
 * Post a comment, if the recipe takes comments and the author is not flooding.
 *
 * **Published recipes only, checked here rather than trusted from the page.**
 * A draft has no comment surface -- there is no form on it, because there is no
 * page -- but "there is no form" is not a check, for exactly the reason phase
 * 14 spends its time on. The recipe id arrives in a request somebody wrote.
 *
 * The rate limit counts rows in a window rather than keeping a counter, which
 * is the only version that survives a restart or a second container. It is
 * checked before the insert and not inside a transaction with it: two posts
 * racing at the boundary can both see `max - 1` and both land, so the limit is
 * `max` give or take one under concurrency. That is the right trade for a
 * brake on scripted spam -- serialising every comment in the site behind a
 * lock to make the number exact would cost more than the number is worth, and
 * the honest thing is to say so rather than imply a precision this does not
 * have.
 */
export async function createComment(
  db: PrismaClient,
  params: { recipeId: string; authorId: string; body: string; now: Date },
): Promise<CreateCommentResult> {
  const recipe = await db.recipe.findUnique({
    where: { id: params.recipeId },
    select: { status: true },
  });

  if (recipe === null || recipe.status !== "PUBLISHED") {
    return { ok: false, problem: "not-commentable" };
  }

  const recent = await countCommentsSince(db, {
    authorId: params.authorId,
    since: rateLimitWindowStart(params.now),
  });

  if (recent >= COMMENT_RATE_LIMIT.max) return { ok: false, problem: "rate-limited" };

  const comment = await db.comment.create({
    data: { recipeId: params.recipeId, authorId: params.authorId, body: params.body },
    select: { id: true },
  });

  return { ok: true, id: comment.id };
}

/**
 * Remove a comment.
 *
 * `deleteMany` rather than `delete`, so removing one that is already gone is a
 * no-op instead of a thrown `P2025`. Two people pressing Delete on the same
 * comment is an ordinary race on a page two people can both see, and the
 * second one has got what they wanted.
 *
 * Nothing here decides *whether* it may be removed. That is `mayDeleteComment`
 * in the domain layer, called from the action, which is where the session is.
 */
export async function deleteComment(db: PrismaClient, params: { id: string }): Promise<void> {
  await db.comment.deleteMany({ where: { id: params.id } });
}
