import { z } from "zod";

import { isDense } from "./positions";

/**
 * The two ordered lists a recipe owns, as they arrive from the editor.
 *
 * The editor is a Client Component holding the authoritative list, so it posts
 * that list verbatim -- positions and all -- as JSON in one hidden field. What
 * reaches the Server Action is therefore a string, and a string somebody else
 * could have written: `parseRecipeListsJson` is where that stops being
 * assumed.
 *
 * **Positions are validated, not repaired.** `isDense` decides, and a payload
 * that fails is refused rather than silently renumbered. Renumbering would
 * hide a bug in the editor behind a save that quietly reordered somebody's
 * method, and the client is ours -- if it posts a gap, that is worth hearing
 * about. It is also the contract the database enforces: the deferrable unique
 * constraints would otherwise refuse this at COMMIT, with a message naming an
 * index rather than a list.
 *
 * Pure, per the layering rule. The widths below are the `@db.VarChar` widths
 * from `schema.prisma`, and `tests/db/recipe-limits.test.ts` compares them
 * against the real columns.
 */

export const LIST_LIMITS = {
  ingredient: { quantity: 40, unit: 40, item: 160, note: 200 },
  step: { text: 1000 },

  /**
   * A cap on each list.
   *
   * Not mirroring anything in the database -- it is the only bound there is.
   * An unbounded array on a public endpoint is an invitation, and this is far
   * above any real recipe.
   */
  maxItems: 100,
} as const;

export type IngredientInput = {
  position: number;
  quantity: string | null;
  unit: string | null;
  item: string;
  note: string | null;
};

export type StepInput = { position: number; text: string };

export type RecipeListsInput = { ingredients: IngredientInput[]; steps: StepInput[] };

/** One message per list, naming the row a person can actually see. */
export type RecipeListsErrors = { ingredients?: string; steps?: string };

export type RecipeListsResult =
  { ok: true; value: RecipeListsInput } | { ok: false; errors: RecipeListsErrors };

/* --- Field shapes -------------------------------------------------------- */

/** Trimmed; blank becomes null, because an emptied field holds nothing. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().default(null),
  );

const position = z.number().int().min(0);

const ingredientSchema = z.object({
  position,
  quantity: optionalText(LIST_LIMITS.ingredient.quantity),
  unit: optionalText(LIST_LIMITS.ingredient.unit),
  item: z.string().trim().min(1, "an ingredient needs a name").max(LIST_LIMITS.ingredient.item),
  note: optionalText(LIST_LIMITS.ingredient.note),
});

const stepSchema = z.object({
  position,
  text: z.string().trim().min(1, "a step needs some text").max(LIST_LIMITS.step.text),
});

const listsSchema = z.object({
  ingredients: z.array(ingredientSchema).max(LIST_LIMITS.maxItems, "at most 100 ingredients"),
  steps: z.array(stepSchema).max(LIST_LIMITS.maxItems, "at most 100 steps"),
});

/* --- Parsing ------------------------------------------------------------- */

const LABELS = { ingredients: "Ingredient", steps: "Step" } as const;

/**
 * The first problem in one list, worded for somebody looking at the screen.
 *
 * Rows are numbered from one, because "Ingredient 3" is findable and "index 2"
 * is not. An issue with no row -- the array cap, or the whole value being the
 * wrong type -- keeps its own message.
 */
function describeIssue(list: "ingredients" | "steps", issue: z.core.$ZodIssue): string {
  const row = issue.path[1];
  if (typeof row !== "number") return issue.message;
  return `${LABELS[list]} ${String(row + 1)}: ${issue.message}`;
}

export function parseRecipeLists(raw: unknown): RecipeListsResult {
  const result = listsSchema.safeParse(raw);

  if (!result.success) {
    const errors: RecipeListsErrors = {};
    for (const issue of result.error.issues) {
      const list = issue.path[0];
      // A payload that is not an object at all produces issues with an empty
      // path. Blame the ingredients: it is the first list, and no editor of
      // ours sent this.
      const key = list === "steps" ? "steps" : "ingredients";
      errors[key] ??= describeIssue(key, issue);
    }
    return { ok: false, errors };
  }

  const value = result.data;
  const errors: RecipeListsErrors = {};

  // Density last, and separately, because it is a statement about the list as
  // a whole rather than about any one row -- there is no row to blame.
  if (!isDense(value.ingredients)) {
    errors.ingredients = "The ingredient positions are not 0, 1, 2 with no gap or repeat.";
  }
  if (!isDense(value.steps)) {
    errors.steps = "The step positions are not 0, 1, 2 with no gap or repeat.";
  }

  if (errors.ingredients !== undefined || errors.steps !== undefined) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}

/**
 * Decode the hidden field, then validate it.
 *
 * `JSON.parse` throws on malformed input, and a Server Action that throws is a
 * 500 where a message belongs. This is the layer that catches it -- and the
 * value is whatever `formData.get` returned, which is `File | string | null`.
 */
export function parseRecipeListsJson(raw: unknown): RecipeListsResult {
  if (typeof raw !== "string") {
    return { ok: false, errors: { ingredients: "The lists were not sent." } };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, errors: { ingredients: "The lists could not be read." } };
  }

  return parseRecipeLists(decoded);
}
