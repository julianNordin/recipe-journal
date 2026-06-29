import { describe, expect, it } from "vitest";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeRecipe, makeUser } from "./setup/factories";

const db = cleanDatabasePerTest();

describe("relations and delete behaviour", () => {
  it("cascades from a deleted recipe to its children", async () => {
    const recipe = await makeRecipe(db(), {
      ingredients: ["flour", "water"],
      steps: ["mix", "bake"],
    });

    await db().recipe.delete({ where: { id: recipe.id } });

    expect(await db().recipeIngredient.count({ where: { recipeId: recipe.id } })).toBe(0);
    expect(await db().recipeStep.count({ where: { recipeId: recipe.id } })).toBe(0);
    expect(await db().recipeSlug.count({ where: { recipeId: recipe.id } })).toBe(0);
  });

  it("refuses to delete an author who still has recipes", async () => {
    const author = await makeUser(db());
    await makeRecipe(db(), { author });

    await expect(db().user.delete({ where: { id: author.id } })).rejects.toThrow();

    // And the author is still there, rather than half-deleted.
    expect(await db().user.count({ where: { id: author.id } })).toBe(1);
  });

  it("allows deleting an author once their recipes are gone", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author });

    await db().recipe.delete({ where: { id: recipe.id } });
    await db().user.delete({ where: { id: author.id } });

    expect(await db().user.count({ where: { id: author.id } })).toBe(0);
  });

  it("cascades from a deleted user to their comments", async () => {
    const author = await makeUser(db());
    const commenter = await makeUser(db());
    const recipe = await makePublishedRecipe(db(), { author });

    await db().comment.create({
      data: { recipeId: recipe.id, authorId: commenter.id, body: "Good." },
    });

    await db().user.delete({ where: { id: commenter.id } });

    expect(await db().comment.count({ where: { recipeId: recipe.id } })).toBe(0);
  });
});

describe("uniqueness the schema declares", () => {
  it("rejects a duplicate email", async () => {
    await makeUser(db(), { email: "taken@example.com" });
    await expect(makeUser(db(), { email: "taken@example.com" })).rejects.toThrow();
  });

  it("rejects a slug already used by another recipe", async () => {
    await makeRecipe(db(), { slug: "shared" });
    await expect(makeRecipe(db(), { slug: "shared" })).rejects.toThrow();
  });

  it("rejects two ingredients at the same position in one recipe", async () => {
    const recipe = await makeRecipe(db());
    await db().recipeIngredient.create({
      data: { recipeId: recipe.id, position: 0, item: "flour" },
    });

    await expect(
      db().recipeIngredient.create({ data: { recipeId: recipe.id, position: 0, item: "water" } }),
    ).rejects.toThrow();
  });

  it("allows the same position in two different recipes", async () => {
    const a = await makeRecipe(db());
    const b = await makeRecipe(db());

    await db().recipeIngredient.create({ data: { recipeId: a.id, position: 0, item: "flour" } });
    await db().recipeIngredient.create({ data: { recipeId: b.id, position: 0, item: "flour" } });

    expect(await db().recipeIngredient.count()).toBe(2);
  });
});

describe("the shape the application relies on", () => {
  it("stores timestamps with a time zone, not without", async () => {
    const rows = await db().$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'recipes' AND column_name = 'published_at'
    `;
    expect(rows[0]?.data_type).toBe("timestamp with time zone");
  });

  it("generates time-ordered v7 identifiers", async () => {
    const first = await makeUser(db());
    const second = await makeUser(db());

    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    // v7 embeds a timestamp in its leading bits, so later ids sort after
    // earlier ones. That is the whole reason for choosing it over v4.
    expect(second.id > first.id).toBe(true);
  });

  it("defaults a new recipe to an unpublished draft", async () => {
    const recipe = await makeRecipe(db());
    expect(recipe.status).toBe("DRAFT");
    expect(recipe.publishedAt).toBeNull();
  });
});
