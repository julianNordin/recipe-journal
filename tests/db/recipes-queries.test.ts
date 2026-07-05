import { describe, expect, it } from "vitest";

import { countPublishedRecipes, findPublishedRecipeBySlug } from "@/server/recipes/queries";

import { cleanDatabasePerTest, seqScanOnlyDb } from "./setup/database";
import { makePublishedRecipe, makeRecipe, makeUser } from "./setup/factories";

const db = cleanDatabasePerTest();

/**
 * The first test of a real query function rather than of raw Prisma.
 *
 * This is only possible because the query takes its client as an argument. The
 * application hands it the `server-only` singleton; this hands it one pointed
 * at a throwaway container.
 */
describe("countPublishedRecipes", () => {
  it("returns zero on an empty database", async () => {
    expect(await countPublishedRecipes(db())).toBe(0);
  });

  it("counts published recipes", async () => {
    await makePublishedRecipe(db());
    await makePublishedRecipe(db());

    expect(await countPublishedRecipes(db())).toBe(2);
  });

  it("does not count drafts", async () => {
    await makePublishedRecipe(db());
    await makeRecipe(db());
    await makeRecipe(db());

    // Three rows exist; one is published.
    expect(await db().recipe.count()).toBe(3);
    expect(await countPublishedRecipes(db())).toBe(1);
  });

  it("stops counting a recipe that is unpublished again", async () => {
    const recipe = await makePublishedRecipe(db());
    expect(await countPublishedRecipes(db())).toBe(1);

    await db().recipe.update({
      where: { id: recipe.id },
      data: { status: "DRAFT", publishedAt: null },
    });

    expect(await countPublishedRecipes(db())).toBe(0);
  });
});

/**
 * The query behind the recipe detail page.
 *
 * The name states the security property rather than leaving it to the caller:
 * this finds *published* recipes. Phase 14 adds the author's own view of a
 * draft, and it will be a different function with a viewer argument, so that
 * no page can accidentally reach the permissive one.
 */
describe("findPublishedRecipeBySlug", () => {
  it("returns null for a slug that does not exist", async () => {
    expect(await findPublishedRecipeBySlug(db(), "nothing-here")).toBeNull();
  });

  it("finds a published recipe by its current slug", async () => {
    await makePublishedRecipe(db(), { slug: "no-knead-sourdough", title: "No-knead sourdough" });

    const recipe = await findPublishedRecipeBySlug(db(), "no-knead-sourdough");

    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe("No-knead sourdough");
    expect(recipe?.slug).toBe("no-knead-sourdough");
  });

  it("does not find a draft", async () => {
    // The page-level half of the rule Phase 14 proves on all three surfaces.
    // With no auth yet, published is the only thing anyone may read.
    await makeRecipe(db(), { slug: "secret-draft" });

    expect(await findPublishedRecipeBySlug(db(), "secret-draft")).toBeNull();
  });

  it("does not find a recipe by a slug it used to have", async () => {
    const recipe = await makePublishedRecipe(db(), { slug: "current-name" });
    await db().recipeSlug.create({
      data: { slug: "old-name", recipeId: recipe.id, isCurrent: false },
    });

    // Not an oversight: serving the same recipe at both URLs is duplicate
    // content. Phase 15 makes the old one a 308 to the current one, which
    // needs a different query -- this one is deliberately strict.
    expect(await findPublishedRecipeBySlug(db(), "old-name")).toBeNull();
    expect(await findPublishedRecipeBySlug(db(), "current-name")).not.toBeNull();
  });

  it("returns ingredients and steps in position order", async () => {
    const recipe = await makePublishedRecipe(db(), { slug: "ordered" });

    // Inserted deliberately out of position order, so heap order and position
    // order disagree.
    await db().recipeIngredient.createMany({
      data: [
        { recipeId: recipe.id, position: 2, item: "third" },
        { recipeId: recipe.id, position: 0, item: "first" },
        { recipeId: recipe.id, position: 1, item: "second" },
      ],
    });
    await db().recipeStep.createMany({
      data: [
        { recipeId: recipe.id, position: 1, text: "then this" },
        { recipeId: recipe.id, position: 2, text: "finally this" },
        { recipeId: recipe.id, position: 0, text: "do this" },
      ],
    });

    // Read through the client that cannot use an index scan. Through the
    // ordinary one this assertion is worthless: the unique indexes behind
    // phase 06's deferrable position constraints let Postgres answer
    // `WHERE recipe_id = ?` in `(recipe_id, position)` order without being
    // asked, so both `orderBy` clauses can be deleted from the query and every
    // assertion here still passes. Measured, not assumed.
    const found = await findPublishedRecipeBySlug(seqScanOnlyDb(), "ordered");

    // Positive control: the same rows, unordered, do not arrive sorted. If a
    // future edit makes the fixture stop being adversarial, this fails here
    // rather than quietly hollowing out the assertions below.
    const heapOrder = await seqScanOnlyDb().$queryRawUnsafe<{ text: string }[]>(
      `SELECT text FROM recipe_steps WHERE recipe_id = '${recipe.id}'`,
    );
    expect(heapOrder.map((r) => r.text)).toEqual(["then this", "finally this", "do this"]);

    expect(found?.ingredients.map((i) => i.item)).toEqual(["first", "second", "third"]);
    expect(found?.steps.map((s) => s.text)).toEqual(["do this", "then this", "finally this"]);
  });

  it("carries the ingredient parts the page renders", async () => {
    const recipe = await makePublishedRecipe(db(), { slug: "parts" });
    await db().recipeIngredient.create({
      data: {
        recipeId: recipe.id,
        position: 0,
        quantity: "500",
        unit: "g",
        item: "strong white flour",
        note: "plus extra for dusting",
      },
    });

    const [ingredient] = (await findPublishedRecipeBySlug(db(), "parts"))?.ingredients ?? [];

    expect(ingredient).toMatchObject({
      quantity: "500",
      unit: "g",
      item: "strong white flour",
      note: "plus extra for dusting",
    });
  });

  it("returns the author's public fields and nothing else", async () => {
    // The reason this layer selects columns instead of using `include`.
    // `include: { author: true }` hands the whole User row -- password hash
    // and email included -- to a component that renders it into a page. The
    // assertion bites the moment someone reaches for the shorter spelling.
    const author = await makeUser(db(), {
      name: "Ada",
      email: "ada@example.com",
      passwordHash: "$argon2id$not-a-real-hash",
    });
    await makePublishedRecipe(db(), { slug: "by-ada", author });

    const found = await findPublishedRecipeBySlug(db(), "by-ada");

    expect(found?.author.name).toBe("Ada");
    expect(found?.author).not.toHaveProperty("passwordHash");
    expect(found?.author).not.toHaveProperty("email");
  });

  it("returns tags flattened out of the join table", async () => {
    const recipe = await makePublishedRecipe(db(), { slug: "tagged" });
    const tag = await db().tag.create({ data: { slug: "bread", name: "Bread" } });
    await db().recipeTag.create({ data: { recipeId: recipe.id, tagId: tag.id } });

    // The page should never see the join row. Shaping it here is what keeps
    // `recipe.tags[0].tag.name` out of the template.
    expect((await findPublishedRecipeBySlug(db(), "tagged"))?.tags).toEqual([
      { slug: "bread", name: "Bread" },
    ]);
  });

  it("returns an empty list rather than null for a recipe with no tags", async () => {
    await makePublishedRecipe(db(), { slug: "untagged" });

    const found = await findPublishedRecipeBySlug(db(), "untagged");

    expect(found?.tags).toEqual([]);
    expect(found?.ingredients).toEqual([]);
    expect(found?.steps).toEqual([]);
  });
});
