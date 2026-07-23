import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Reads for comments.
 *
 * Same rule as the recipe queries next door: the client is an argument, never
 * an import, so these can be driven against a throwaway container instead of
 * only through a browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CommentView = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string | null; image: string | null };
};

/**
 * A recipe's comments, oldest first.
 *
 * Oldest first because it is a conversation and a conversation reads
 * downwards. Newest-first is right for a feed of unrelated things and wrong
 * for a page where the second comment may be answering the first.
 *
 * Columns are selected rather than the relation included, so the author's
 * email and password hash cannot reach a component by accident. Same rule as
 * `findPublishedRecipeBySlug`, and there is a test for it there.
 */
export async function listCommentsForRecipe(
  db: PrismaClient,
  recipeId: string,
): Promise<CommentView[]> {
  if (!UUID.test(recipeId)) return [];

  return db.comment.findMany({
    where: { recipeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
  });
}

export type CommentContext = {
  commentAuthorId: string;
  recipeAuthorId: string;
  recipeId: string;
};

/**
 * Everything the deletion rule needs, in one query.
 *
 * `mayDeleteComment` compares three ids and this is where two of them come
 * from -- so fetching them separately would mean two round trips and a window
 * in which they describe different states. Null for a comment that is not
 * there, which the caller turns into the same refusal it gives for one that is
 * not theirs.
 */
export async function findCommentContext(
  db: PrismaClient,
  commentId: string,
): Promise<CommentContext | null> {
  if (!UUID.test(commentId)) return null;

  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: {
      authorId: true,
      recipeId: true,
      recipe: { select: { authorId: true } },
    },
  });

  if (comment === null) return null;

  return {
    commentAuthorId: comment.authorId,
    recipeAuthorId: comment.recipe.authorId,
    recipeId: comment.recipeId,
  };
}

/**
 * How many comments this person has posted since `since`.
 *
 * **Counted from rows, not held in memory.** A counter in a module-level Map
 * is per-process: it resets on every deploy, and two containers behind a load
 * balancer each enforce half the limit while believing they enforce all of it.
 * The index on `(author_id, created_at)` is what makes this cheap enough to do
 * on every post.
 */
export async function countCommentsSince(
  db: PrismaClient,
  params: { authorId: string; since: Date },
): Promise<number> {
  return db.comment.count({
    where: { authorId: params.authorId, createdAt: { gte: params.since } },
  });
}
