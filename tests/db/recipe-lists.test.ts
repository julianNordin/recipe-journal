import { describe, expect, it } from "vitest";

import type { IngredientInput, StepInput } from "@/domain/recipe-lists";
import { replaceRecipeLists } from "@/server/recipes/commands";
import { findAuthoredRecipe } from "@/server/recipes/queries";

import { cleanDatabasePerTest, seqScanOnlyDb } from "./setup/database";
import { makeRecipe, makeUser } from "./setup/factories";

/**
 * Writing a recipe's two ordered lists, and reading them back in order.
 *
 * The editor holds the whole list and posts the whole list, so this is a
 * replace rather than a diff. What has to be true afterwards is exactly what
 * the deferrable unique constraints say: positions dense from zero, unique
 * within the recipe, and nobody else's rows touched.
 */

const db = cleanDatabasePerTest();

const ing = (position: number, item: string, extra: Partial<IngredientInput> = {}) => ({
  position,
  item,
  quantity: null,
  unit: null,
  note: null,
  ...extra,
});

const stp = (position: number, text: string): StepInput => ({ position, text });

describe("replaceRecipeLists", () => {
  it("writes both lists", async () => {
    const recipe = await makeRecipe(db());

    await replaceRecipeLists(db(), {
      recipeId: recipe.id,
      ingredients: [ing(0, "flour", { quantity: "500", unit: "g" }), ing(1, "water")],
      steps: [stp(0, "Mix."), stp(1, "Bake.")],
    });

    const ingredients = await db().recipeIngredient.findMany({ where: { recipeId: recipe.id } });
    const steps = await db().recipeStep.findMany({ where: { recipeId: recipe.id } });

    expect(ingredients).toHaveLength(2);
    expect(steps).toHaveLength(2);
    expect(ingredients.find((i) => i.position === 0)?.quantity).toBe("500");
    expect(ingredients.find((i) => i.position === 1)?.quantity).toBeNull();
  });

  it("replaces what was there rather than adding to it", async () => {
    const recipe = await makeRecipe(db(), {
      ingredients: ["old one", "old two", "old three"],
      steps: ["old step"],
    });

    await replaceRecipeLists(db(), {
      recipeId: recipe.id,
      ingredients: [ing(0, "the only one")],
      steps: [],
    });

    const ingredients = await db().recipeIngredient.findMany({ where: { recipeId: recipe.id } });
    expect(ingredients.map((i) => i.item)).toEqual(["the only one"]);
    expect(await db().recipeStep.count({ where: { recipeId: recipe.id } })).toBe(0);
  });

  it("accepts two empty lists", async () => {
    const recipe = await makeRecipe(db(), { ingredients: ["flour"], steps: ["Mix."] });

    await replaceRecipeLists(db(), { recipeId: recipe.id, ingredients: [], steps: [] });

    expect(await db().recipeIngredient.count({ where: { recipeId: recipe.id } })).toBe(0);
    expect(await db().recipeStep.count({ where: { recipeId: recipe.id } })).toBe(0);
  });

  it("saves a reorder as new positions for the same items", async () => {
    const recipe = await makeRecipe(db(), { steps: ["first", "second", "third"] });

    // What the editor posts after one "move up" on the last row.
    await replaceRecipeLists(db(), {
      recipeId: recipe.id,
      ingredients: [],
      steps: [stp(0, "first"), stp(1, "third"), stp(2, "second")],
    });

    const steps = await db().recipeStep.findMany({ where: { recipeId: recipe.id } });
    expect(steps.find((s) => s.text === "third")?.position).toBe(1);
    expect(steps.find((s) => s.text === "second")?.position).toBe(2);
  });

  it("leaves another recipe's lists alone", async () => {
    const author = await makeUser(db());
    const mine = await makeRecipe(db(), { author, ingredients: ["mine"] });
    const theirs = await makeRecipe(db(), { author, ingredients: ["theirs one", "theirs two"] });

    await replaceRecipeLists(db(), { recipeId: mine.id, ingredients: [], steps: [] });

    // `deleteMany` without a `recipeId` would empty the whole table and every
    // test above would still pass.
    expect(await db().recipeIngredient.count({ where: { recipeId: theirs.id } })).toBe(2);
  });

  it("rolls back whole when one of the two lists cannot be written", async () => {
    const recipe = await makeRecipe(db(), { ingredients: ["keep me"], steps: ["keep me too"] });

    await expect(
      replaceRecipeLists(db(), {
        recipeId: recipe.id,
        ingredients: [ing(0, "new one")],
        // Past the column width. The schema stops this long before here; the
        // point is what happens to the ingredients when it does not.
        steps: [stp(0, "a".repeat(2000))],
      }),
    ).rejects.toThrow();

    const ingredients = await db().recipeIngredient.findMany({ where: { recipeId: recipe.id } });
    const steps = await db().recipeStep.findMany({ where: { recipeId: recipe.id } });
    expect(ingredients.map((i) => i.item)).toEqual(["keep me"]);
    expect(steps.map((s) => s.text)).toEqual(["keep me too"]);
  });

  it("refuses a payload the deferrable constraint would refuse", async () => {
    const recipe = await makeRecipe(db());

    // Two rows claiming position 0. The schema catches this first -- `isDense`
    // -- but the constraint is what makes that a rule rather than a
    // convention, and this is the assertion that says so.
    await expect(
      replaceRecipeLists(db(), {
        recipeId: recipe.id,
        ingredients: [ing(0, "one"), ing(0, "two")],
        steps: [],
      }),
    ).rejects.toThrow();

    expect(await db().recipeIngredient.count({ where: { recipeId: recipe.id } })).toBe(0);
  });
});

describe("reading the lists back for the editor", () => {
  it("returns them in position order", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author });

    // Written in an order that is not the answer, so the heap cannot supply
    // the sort by accident.
    await replaceRecipeLists(db(), {
      recipeId: recipe.id,
      ingredients: [ing(1, "second"), ing(2, "third"), ing(0, "first")],
      steps: [stp(2, "last"), stp(0, "start"), stp(1, "middle")],
    });

    /*
     * Read through the client that may not use an index. Without it the
     * assertion is decoration -- gotcha 52: the unique indexes backing the
     * deferrable position constraints answer `WHERE recipe_id = ?` in position
     * order having never been asked to, so deleting the `orderBy` changes no
     * test result.
     */
    const found = await findAuthoredRecipe(seqScanOnlyDb(), {
      id: recipe.id,
      authorId: author.id,
    });

    // Positive control: the same rows, unsorted, arrive in insertion order. If
    // a later edit stops the fixture being adversarial, this fails here rather
    // than quietly hollowing out the lines below.
    const heapOrder = await seqScanOnlyDb().$queryRawUnsafe<{ item: string }[]>(
      `SELECT item FROM recipe_ingredients WHERE recipe_id = '${recipe.id}'`,
    );
    expect(heapOrder.map((r) => r.item)).toEqual(["second", "third", "first"]);

    expect(found?.ingredients.map((i) => i.item)).toEqual(["first", "second", "third"]);
    expect(found?.steps.map((s) => s.text)).toEqual(["start", "middle", "last"]);
  });

  it("gives every row a stable id for the editor to key on", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author, ingredients: ["flour"], steps: ["Mix."] });

    const found = await findAuthoredRecipe(db(), { id: recipe.id, authorId: author.id });

    // React needs an identity that survives a reorder, and the reducer
    // addresses rows by key rather than by index. The row's own id is that
    // identity for anything already saved.
    expect(found?.ingredients[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(found?.steps[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns empty lists for a recipe that has none", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author });

    const found = await findAuthoredRecipe(db(), { id: recipe.id, authorId: author.id });

    expect(found?.ingredients).toEqual([]);
    expect(found?.steps).toEqual([]);
  });
});
