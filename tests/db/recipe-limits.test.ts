import { describe, expect, it } from "vitest";

import { RECIPE_LIMITS } from "@/domain/recipe-input";

import { cleanDatabasePerTest } from "./setup/database";
import { makeUser } from "./setup/factories";

/**
 * The column widths and `RECIPE_LIMITS` are the same numbers, and nothing else
 * makes them stay that way.
 *
 * Three places hold them: `schema.prisma`'s `@db.VarChar`, the migration SQL
 * it generated, and `src/domain/recipe-input.ts`. The first two cannot drift
 * from each other -- one produced the other -- but neither of them reads the
 * third, and the third is what the form and the Server Action both validate
 * against.
 *
 * **The drift that matters has a direction.** A validator that accepts *less*
 * than the column holds is only a slightly mean form. A validator that accepts
 * *more* is a Postgres error on submit, after the author has typed the whole
 * thing, with a message about `character varying(160)`.
 */

const db = cleanDatabasePerTest();

/** Widths as Postgres reports them, keyed by column name. */
async function columnWidths(table: string): Promise<Record<string, number | null>> {
  const rows = await db().$queryRaw<
    { column_name: string; character_maximum_length: number | null }[]
  >`
    SELECT column_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return Object.fromEntries(rows.map((r) => [r.column_name, r.character_maximum_length]));
}

describe("RECIPE_LIMITS against the recipes table", () => {
  it("matches the declared column widths", async () => {
    const widths = await columnWidths("recipes");

    expect(widths.title).toBe(RECIPE_LIMITS.title);
    expect(widths.summary).toBe(RECIPE_LIMITS.summary);
    expect(widths.hero_image_url).toBe(RECIPE_LIMITS.heroImageUrl);
  });

  it("says out loud that the body has no column width to match", async () => {
    const widths = await columnWidths("recipes");

    /*
     * `body` is `text`, so `character_maximum_length` is null and
     * `RECIPE_LIMITS.body` mirrors nothing. It is the only bound that exists,
     * which is worth an assertion rather than a comment: if the column ever
     * gains a width, this fails and somebody has to decide which number wins.
     */
    expect(widths.body).toBeNull();
    expect(RECIPE_LIMITS.body).toBeGreaterThan(0);
  });
});

describe("the widths as the database actually enforces them", () => {
  /*
   * Reading `information_schema` proves the two numbers are equal. It does not
   * prove the number means what the test thinks it means -- that a title of
   * exactly that length fits and one character more does not. These two do,
   * and they would survive a rewrite of the metadata query.
   */
  async function insertTitle(title: string) {
    const author = await makeUser(db());
    return db().recipe.create({
      data: {
        title,
        body: "",
        servings: 1,
        prepMinutes: 0,
        cookMinutes: 0,
        authorId: author.id,
      },
    });
  }

  it("accepts a title of exactly the limit", async () => {
    const recipe = await insertTitle("a".repeat(RECIPE_LIMITS.title));
    expect(recipe.title).toHaveLength(RECIPE_LIMITS.title);
  });

  it("rejects a title one character longer", async () => {
    await expect(insertTitle("a".repeat(RECIPE_LIMITS.title + 1))).rejects.toThrow();
  });
});
