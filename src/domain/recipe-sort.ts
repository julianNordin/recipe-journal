/**
 * The orders a listing may be asked for, and nothing else.
 *
 * **A whitelist rather than a validator.** The alternative -- taking a column
 * name from a query string and handing it to the query builder -- reads as a
 * feature and is an injection surface plus a promise to keep every column
 * name stable forever. Four names, mapped to orderings in one place in
 * `src/server`, and anything else is a 400 that says what was allowed.
 *
 * Pure and here rather than beside the query, so the route handler, the pages
 * and the tests all validate against the same list. The mapping to Prisma's
 * `orderBy` is the query layer's business and is exhaustive over this union,
 * which is what makes "an unknown sort cannot reach the database" a fact the
 * compiler checks rather than a rule somebody remembers.
 */

export const RECIPE_SORTS = ["newest", "oldest", "title", "quickest"] as const;

export type RecipeSort = (typeof RECIPE_SORTS)[number];

export const DEFAULT_RECIPE_SORT: RecipeSort = "newest";

/** Human-readable, for the 400 that refuses everything else. */
export const RECIPE_SORT_LABELS: Record<RecipeSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "By title",
  // Cooking time, not total time. Prisma cannot order by an expression, so
  // `prepMinutes + cookMinutes` would need a generated column -- which is a
  // migration, a trigger's worth of thinking and a second place for the number
  // to be wrong, to sort a list nobody has asked to sort that precisely.
  quickest: "Quickest to cook",
};

/**
 * The sort this request asked for, or null if it asked for something else.
 *
 * Null rather than a silent fallback to the default. A misspelt `?sort=` that
 * quietly returns the default order is a bug report that starts "the sort does
 * not work", and the answer is a 400 naming the four things that do.
 *
 * An absent parameter is not an error -- that is the ordinary case, and it
 * gets the default.
 */
export function parseRecipeSort(raw: string | null | undefined): RecipeSort | null {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_RECIPE_SORT;

  return (RECIPE_SORTS as readonly string[]).includes(raw) ? (raw as RecipeSort) : null;
}

/**
 * A search term worth running, or null.
 *
 * Trimmed, because a query string of spaces is not a search, and collapsed to
 * null so callers have one thing to check rather than two.
 *
 * **No minimum length, and that is a decision.** A trigram index cannot help a
 * pattern shorter than three characters -- there are no whole trigrams in
 * `ry` -- so a one- or two-character search is a sequential scan. Refusing
 * those would be faster and would also refuse `ho` from somebody looking for
 * `hollandaise`, on a site with three recipes. The honest note is that the
 * index earns its keep from three characters up.
 */
export function parseSearchTerm(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const term = raw.trim();
  return term.length === 0 ? null : term;
}
