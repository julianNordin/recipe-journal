import { describe, expect, it } from "vitest";

import { RECIPE_SORTS } from "@/domain/recipe-sort";
import { listPublishedRecipes } from "@/server/recipes/queries";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeRecipe } from "./setup/factories";

/**
 * Searching and sorting a listing, against real Postgres.
 *
 * The parsing is pure and covered in the fast tier. What needs a database is
 * everything that is actually SQL: that `contains` really is case-insensitive,
 * that the search touches the title and the summary and not the body, that a
 * draft is never in the results however it is asked for, and that every name
 * on the whitelist maps to an ordering the database accepts.
 */

const db = cleanDatabasePerTest();

const titles = async (options: Parameters<typeof listPublishedRecipes>[1]) =>
  (await listPublishedRecipes(db(), options)).items.map((r) => r.title);

const PAGE = { skip: 0, take: 20 };

describe("searching a listing", () => {
  it("matches on the title, whatever the case", async () => {
    await makePublishedRecipe(db(), { title: "No-knead sourdough", slug: "a" });
    await makePublishedRecipe(db(), { title: "Yellow split pea soup", slug: "b" });

    expect(await titles({ ...PAGE, query: "SOURDOUGH" })).toEqual(["No-knead sourdough"]);
    expect(await titles({ ...PAGE, query: "sourdough" })).toEqual(["No-knead sourdough"]);
  });

  it("matches on the summary too", async () => {
    await makePublishedRecipe(db(), {
      title: "Rye crispbread",
      slug: "c",
      summary: "Rolled thin and baked until it snaps.",
    });
    await makePublishedRecipe(db(), { title: "Something else", slug: "d", summary: "Not that." });

    expect(await titles({ ...PAGE, query: "snaps" })).toEqual(["Rye crispbread"]);
  });

  it("does not match on the body", async () => {
    await makePublishedRecipe(db(), {
      title: "Rye crispbread",
      slug: "e",
      summary: "Thin.",
      body: "Roll it thinner than feels sensible.",
    });

    /*
     * **Deliberate, and the reason is about results rather than cost.** A
     * recipe body mentions flour; searching it would return every bread recipe
     * for `flour`, and there would then be no way to ask for the ones that are
     * *about* flour. Title and summary are what a cook wrote to describe the
     * thing.
     */
    expect(await titles({ ...PAGE, query: "sensible" })).toEqual([]);
  });

  it("matches a fragment in the middle of a word", async () => {
    await makePublishedRecipe(db(), { title: "Cardamom buns", slug: "f" });

    // The leading wildcard is the whole reason the trigram indexes exist: a
    // B-tree has no prefix to seek on here.
    expect(await titles({ ...PAGE, query: "damo" })).toEqual(["Cardamom buns"]);
  });

  it("never returns a draft, however specific the search", async () => {
    await makeRecipe(db(), { title: "Secret cardamom buns", slug: "g" });

    // The search filter is added to the same `where` the status filter is in,
    // not instead of it. A search is not a way in.
    expect(await titles({ ...PAGE, query: "Secret cardamom buns" })).toEqual([]);
  });

  it("counts the filtered set, not the whole one", async () => {
    await makePublishedRecipe(db(), { title: "Sourdough one", slug: "h" });
    await makePublishedRecipe(db(), { title: "Sourdough two", slug: "i" });
    await makePublishedRecipe(db(), { title: "Something else", slug: "j" });

    // One `where` for both the items and the total. If the pager's total
    // described a different filter, it would offer a page that came back empty.
    const page = await listPublishedRecipes(db(), { skip: 0, take: 1, query: "sourdough" });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it("combines with a tag filter rather than replacing it", async () => {
    // The factory attaches no tags, so this recipe matches the search and not
    // the filter. Both clauses live in the same `where` and are ANDed; a
    // search that replaced the filter would return it.
    await makePublishedRecipe(db(), { title: "Sourdough loaf", slug: "k" });

    expect(await titles({ ...PAGE, query: "sourdough" })).toEqual(["Sourdough loaf"]);
    expect(await titles({ ...PAGE, query: "sourdough", tagSlug: "bread" })).toEqual([]);
  });
});

describe("sorting a listing", () => {
  it("accepts every name on the whitelist", async () => {
    await makePublishedRecipe(db(), { title: "Beta", slug: "l" });
    await makePublishedRecipe(db(), { title: "Alpha", slug: "m" });

    // The point is that each one is an ordering Postgres accepts. A name that
    // mapped to nothing would be a runtime error here and nowhere else.
    for (const sort of RECIPE_SORTS) {
      expect((await titles({ ...PAGE, sort })).sort()).toEqual(["Alpha", "Beta"]);
    }
  });

  it("orders by title when asked", async () => {
    await makePublishedRecipe(db(), { title: "Zucchini fritters", slug: "n" });
    await makePublishedRecipe(db(), { title: "Almond cake", slug: "o" });
    await makePublishedRecipe(db(), { title: "Mushroom soup", slug: "p" });

    expect(await titles({ ...PAGE, sort: "title" })).toEqual([
      "Almond cake",
      "Mushroom soup",
      "Zucchini fritters",
    ]);
  });

  it("orders by publish date in both directions", async () => {
    await makePublishedRecipe(db(), {
      title: "Older",
      slug: "q",
      publishedAt: new Date("2026-06-24T07:40:00.000Z"),
    });
    await makePublishedRecipe(db(), {
      title: "Newer",
      slug: "r",
      publishedAt: new Date("2026-07-15T09:30:00.000Z"),
    });

    expect(await titles({ ...PAGE, sort: "newest" })).toEqual(["Newer", "Older"]);
    expect(await titles({ ...PAGE, sort: "oldest" })).toEqual(["Older", "Newer"]);
  });

  it("orders by cooking time, and says that is what it means", async () => {
    await makePublishedRecipe(db(), {
      title: "Long cook",
      slug: "s",
      prepMinutes: 1,
      cookMinutes: 90,
    });
    await makePublishedRecipe(db(), {
      title: "Short cook",
      slug: "t",
      prepMinutes: 60,
      cookMinutes: 5,
    });

    /*
     * Total time would put "Long cook" (91) after "Short cook" (65) as well,
     * so this fixture cannot tell the two definitions apart -- and that is
     * fine, because the definition is `cookMinutes` and it is documented as
     * such. Prisma cannot order by an expression, so total time would need a
     * generated column: a migration and a second place for the number to be
     * wrong, to sort a list nobody has asked to sort that precisely.
     */
    expect(await titles({ ...PAGE, sort: "quickest" })).toEqual(["Short cook", "Long cook"]);
  });

  it("defaults to newest when no sort is given", async () => {
    await makePublishedRecipe(db(), {
      title: "Older",
      slug: "u",
      publishedAt: new Date("2026-06-24T07:40:00.000Z"),
    });
    await makePublishedRecipe(db(), {
      title: "Newer",
      slug: "v",
      publishedAt: new Date("2026-07-15T09:30:00.000Z"),
    });

    expect(await titles(PAGE)).toEqual(["Newer", "Older"]);
  });
});

describe("the indexes search depends on", () => {
  it("are GIN indexes over trigrams, on both searched columns", async () => {
    const rows = await db().$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'recipes' AND indexdef ILIKE '%gin_trgm_ops%'
      ORDER BY indexname
    `;

    /*
     * **What this can and cannot say.** It asserts the indexes exist and are
     * the right kind -- GIN, with the trigram operator class, on the two
     * columns the search touches. It says nothing about the planner *using*
     * them, and no test here honestly could: on a table with a handful of rows
     * a sequential scan is genuinely cheaper and Postgres is right to pick it.
     *
     * Asserting the shape is the part that stays true and the part that breaks
     * loudly, which is what an assertion is for. A missing operator class is
     * the realistic failure -- a plain GIN index on text is created happily and
     * cannot serve `ILIKE` at all.
     */
    expect(rows.map((r) => r.indexname)).toEqual(["recipes_summary_idx", "recipes_title_idx"]);
    for (const row of rows) {
      expect(row.indexdef, row.indexname).toContain("USING gin");
    }
  });
});
