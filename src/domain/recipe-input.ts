import { z } from "zod";

import { HERO_IMAGE_HOSTS, isAllowedHeroImageUrl } from "./hero-image-hosts";

/**
 * What a recipe's own fields may contain -- the one description, read from
 * both ends.
 *
 * The studio form takes its `maxLength`, `min` and `max` attributes from
 * `RECIPE_LIMITS`; the Server Action runs `parseRecipeInput` on whatever
 * arrives. Two copies of these numbers would drift, and the direction they
 * drift in is the bad one: a form that accepts 200 characters and a column
 * that holds 160 turns a typo into a Postgres error on submit.
 *
 * **The database is the third holder of these numbers**, and it does not read
 * this file. `tests/db/recipe-limits.test.ts` closes that loop by reading the
 * column widths out of `information_schema` and comparing them here.
 *
 * Pure, per the layering rule: no Next, no Prisma, no clock. Which is also
 * what makes the case list in `./recipe-input.test.ts` cheap enough to be
 * exhaustive.
 */

export const RECIPE_LIMITS = {
  title: 160,
  summary: 400,
  heroImageUrl: 500,

  /**
   * `body` is an unbounded `text` column, so this bound is not mirroring the
   * database -- it is the only one there is. A Server Action is a public
   * endpoint and an unbounded string field is an invitation.
   */
  body: 20_000,

  /** `servings >= 1` is also a CHECK. The upper bound is only sanity. */
  servings: { min: 1, max: 999 },

  /** 6000 minutes is a hundred hours, which covers a cure and a cold ferment. */
  minutes: { min: 0, max: 6000 },
} as const;

export type RecipeInput = {
  title: string;
  summary: string | null;
  body: string;
  heroImageUrl: string | null;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: "EASY" | "MEDIUM" | "HARD";
};

export type RecipeField = keyof RecipeInput;

/** At most one message per field: the first thing wrong with it. */
export type RecipeFieldErrors = Partial<Record<RecipeField, string>>;

export type RecipeInputResult =
  { ok: true; value: RecipeInput } | { ok: false; errors: RecipeFieldErrors };

/* --- Coercion ------------------------------------------------------------ */

/**
 * Everything arrives as a `FormData` string, including the numbers, so the
 * conversions happen here rather than in three call sites.
 *
 * Blank becomes `undefined` so a required field reports "this is required"
 * rather than whatever `Number("")` -- which is `0` -- would have passed.
 */
function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim() === "" ? undefined : value;
}

/** Blank becomes null: a field an author left empty holds nothing, not "". */
function blankToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim() === "" ? null : value;
}

/**
 * A string, a number, or something that is neither.
 *
 * Non-numeric text becomes `NaN` rather than being handed back unchanged,
 * because `z.number()` rejects `NaN` and the message is then the one written
 * below instead of a type mismatch nobody asked about.
 */
function toNumber(value: unknown): unknown {
  const trimmed = blankToUndefined(value);
  if (trimmed === undefined || typeof trimmed === "number") return trimmed;
  if (typeof trimmed !== "string") return Number.NaN;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function integerField(message: string, bounds: { min: number; max: number }) {
  return z.preprocess(
    toNumber,
    z
      .number({ error: message })
      .int(message)
      .min(bounds.min, message)
      .max(bounds.max, `That is more than ${String(bounds.max)}.`),
  );
}

const atMost = (what: string, n: number) => `A ${what} can be at most ${String(n)} characters.`;

/* --- The schema ---------------------------------------------------------- */

const recipeInputSchema = z.object({
  title: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "A recipe needs a title." })
      .trim()
      .min(1, "A recipe needs a title.")
      .max(RECIPE_LIMITS.title, atMost("title", RECIPE_LIMITS.title)),
  ),

  summary: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(RECIPE_LIMITS.summary, atMost("summary", RECIPE_LIMITS.summary))
      .nullable()
      // Absent and empty are the same answer, and both mean null.
      .default(null),
  ),

  /**
   * Allowed to be empty, deliberately. A recipe needs an introduction *to be
   * published* -- that rule is `publishProblems` in `./publish.ts` and it runs
   * when publishing. Refusing to save an unfinished draft would make this a
   * worse tool than a text file.
   */
  body: z.string().max(RECIPE_LIMITS.body, atMost("recipe body", RECIPE_LIMITS.body)).default(""),

  heroImageUrl: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(RECIPE_LIMITS.heroImageUrl, atMost("URL", RECIPE_LIMITS.heroImageUrl))
      .refine(
        isAllowedHeroImageUrl,
        `Hero images must be https URLs on ${HERO_IMAGE_HOSTS.join(" or ")}.`,
      )
      .nullable()
      .default(null),
  ),

  servings: integerField("Servings must be a whole number, at least 1.", RECIPE_LIMITS.servings),
  prepMinutes: integerField(
    "Preparation time must be a whole number of minutes.",
    RECIPE_LIMITS.minutes,
  ),
  cookMinutes: integerField(
    "Cooking time must be a whole number of minutes.",
    RECIPE_LIMITS.minutes,
  ),

  difficulty: z.enum(["EASY", "MEDIUM", "HARD"], { error: "Choose a difficulty." }),
});

/**
 * Parse whatever was posted.
 *
 * Takes `unknown` and means it. The caller is a Server Action, whose body is
 * whatever the sender chose -- a form, a replayed request, or a hand-written
 * one. `safeParse` rather than `parse` for the same reason: an invalid
 * submission is an ordinary outcome to render, not an exception to handle.
 *
 * Unknown keys are dropped rather than rejected. The action passes the whole
 * form, which carries at least a hidden `id` the schema has no business
 * knowing about, and a strict object would break the moment the form grew a
 * field.
 */
export function parseRecipeInput(raw: unknown): RecipeInputResult {
  const result = recipeInputSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };

  const errors: RecipeFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    // A non-object input produces issues with an empty path. There is no field
    // to blame, so blame the title -- it is the first thing on the form, and
    // the form is not what sent this anyway.
    const key = (typeof field === "string" ? field : "title") as RecipeField;
    // First issue per field wins: "required" is more useful than the
    // "too long" that a later refinement adds about the same empty value.
    errors[key] ??= issue.message;
  }

  return { ok: false, errors };
}
