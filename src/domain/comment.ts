/**
 * What a comment may contain, and who may remove one.
 *
 * Pure, like everything else in this directory: no database, no session, no
 * clock except the one it is handed. Both rules here are the kind that get
 * written twice -- once in a component that decides whether to draw a button,
 * and once in the action that has to mean it -- so they are written once and
 * both callers import them.
 */

/** Matches the column width. `@db.VarChar(2000)` on `comments.body`. */
export const COMMENT_LIMITS = { body: 2000 } as const;

/**
 * How many comments one person may post in a window.
 *
 * **Generous on purpose.** This is a brake on a script, not on a person having
 * a conversation: nobody writes twenty comments in five minutes by hand, and a
 * limit tight enough to inconvenience a real reader is a limit that will be
 * removed the first time it does. The point is that an automated flood costs
 * something, not that discussion is metered.
 *
 * Counted from rows rather than held in memory, because a memory counter is
 * per-process and the container will not be. See `src/server/comments/`.
 */
export const COMMENT_RATE_LIMIT = { max: 20, windowMinutes: 5 } as const;

export type CommentProblem = "empty" | "too-long" | "rate-limited";

export const COMMENT_PROBLEM_MESSAGES: Record<CommentProblem, string> = {
  empty: "Write something first.",
  "too-long": `Comments are limited to ${String(COMMENT_LIMITS.body)} characters.`,
  "rate-limited": "That is a lot of comments in a short time. Try again in a few minutes.",
};

export type CommentInputResult =
  { ok: true; body: string } | { ok: false; problem: CommentProblem };

/**
 * A comment body, trimmed, or the reason it is not one.
 *
 * Trimming before measuring, so a comment of nothing but spaces is empty
 * rather than long enough. The trimmed value is what gets stored: trailing
 * whitespace is invisible in the form and not invisible in the column width.
 */
export function parseCommentBody(raw: unknown): CommentInputResult {
  if (typeof raw !== "string") return { ok: false, problem: "empty" };

  const body = raw.trim();
  if (body.length === 0) return { ok: false, problem: "empty" };
  if (body.length > COMMENT_LIMITS.body) return { ok: false, problem: "too-long" };

  return { ok: true, body };
}

/** The window a rate limit counts over, given the moment being asked about. */
export function rateLimitWindowStart(now: Date): Date {
  return new Date(now.getTime() - COMMENT_RATE_LIMIT.windowMinutes * 60_000);
}

export type DeletionContext = {
  /** Who wrote the comment. */
  commentAuthorId: string;
  /** Who wrote the recipe it is on. */
  recipeAuthorId: string;
  /** Who is asking, or null for a signed-out visitor. */
  userId: string | null;
};

/**
 * Whether this person may delete this comment.
 *
 * Two rules, and the absence of a third is the part worth writing down:
 *
 *  - the person who wrote it may remove it;
 *  - the author of the recipe may remove any comment on their own recipe,
 *    because it is their page and they are the one who has to live with what
 *    is on it;
 *  - **nobody else may, and there is no moderator.** `UserRole` is `USER` or
 *    `AUTHOR`; writing recipes is not a moderation role, so another author has
 *    exactly the standing of any other reader here. Adding an `ADMIN` case
 *    would mean adding the role, the migration and the tests for it, and this
 *    application has nobody to give it to.
 *
 * A pure function rather than a check inside the action, because the component
 * deciding whether to draw a Delete button has to reach the same answer. Two
 * implementations of that would eventually disagree, and the visible failure --
 * a button that does nothing -- is the harmless one of the two.
 */
export function mayDeleteComment(context: DeletionContext): boolean {
  if (context.userId === null) return false;

  return context.userId === context.commentAuthorId || context.userId === context.recipeAuthorId;
}
