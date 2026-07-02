/**
 * The rules that decide whether a recipe may be published, and what publishing
 * does to it.
 *
 * Pure. No database, no Prisma types, and no `new Date()` -- "now" is passed
 * in, so the transition is testable without freezing the system clock.
 *
 * The database enforces the *consistency* of the result (a CHECK requires a
 * published recipe to carry a publish date). This module enforces the
 * *policy*: what counts as complete enough to publish, and what a re-publish
 * must not disturb.
 */

export type PublishableRecipe = {
  status: "DRAFT" | "PUBLISHED";
  title: string;
  summary: string | null;
  body: string;
  publishedAt: Date | null;
  ingredientCount: number;
  stepCount: number;
};

export type PublishProblem =
  "missing-title" | "missing-summary" | "missing-body" | "no-ingredients" | "no-steps";

export const PUBLISH_PROBLEM_MESSAGES: Record<PublishProblem, string> = {
  "missing-title": "A recipe needs a title.",
  "missing-summary": "A recipe needs a short summary before it can be published.",
  "missing-body": "A recipe needs an introduction before it can be published.",
  "no-ingredients": "Add at least one ingredient.",
  "no-steps": "Add at least one step.",
};

const isBlank = (value: string | null | undefined): boolean => (value ?? "").trim().length === 0;

/**
 * Every reason the recipe cannot be published, not just the first.
 *
 * Returning one problem at a time makes the author fix, save, and be told
 * about the next one -- four round trips for four omissions.
 */
export function publishProblems(recipe: PublishableRecipe): PublishProblem[] {
  const problems: PublishProblem[] = [];

  if (isBlank(recipe.title)) problems.push("missing-title");
  if (isBlank(recipe.summary)) problems.push("missing-summary");
  if (isBlank(recipe.body)) problems.push("missing-body");
  if (recipe.ingredientCount < 1) problems.push("no-ingredients");
  if (recipe.stepCount < 1) problems.push("no-steps");

  return problems;
}

export function canPublish(recipe: PublishableRecipe): boolean {
  return publishProblems(recipe).length === 0;
}

export type PublishOutcome =
  { ok: true; status: "PUBLISHED"; publishedAt: Date } | { ok: false; problems: PublishProblem[] };

/**
 * Publishing sets `publishedAt` once and never moves it.
 *
 * A recipe that was published, unpublished to fix a typo, and published again
 * keeps its original date. Stamping "now" on every publish would silently
 * reorder the archive every time anyone corrected a mistake, and the original
 * date would be unrecoverable.
 *
 * This is why `unpublish` leaves the date in place, and why the database CHECK
 * is one-directional rather than a biconditional -- see the migration that
 * relaxes it.
 */
export function publish(recipe: PublishableRecipe, now: Date): PublishOutcome {
  const problems = publishProblems(recipe);
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    status: "PUBLISHED",
    publishedAt: recipe.publishedAt ?? now,
  };
}

/**
 * Unpublishing returns to draft and *keeps* the publish date, so that
 * re-publishing can restore it. A draft carrying a date is not an
 * inconsistency: it is the record of when it was last public.
 */
export function unpublish(recipe: PublishableRecipe): {
  status: "DRAFT";
  publishedAt: Date | null;
} {
  return { status: "DRAFT", publishedAt: recipe.publishedAt };
}

/** Whether a recipe should be visible to someone who is not its author. */
export function isPubliclyVisible(recipe: Pick<PublishableRecipe, "status">): boolean {
  return recipe.status === "PUBLISHED";
}
