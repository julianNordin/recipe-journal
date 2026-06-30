import { describe, expect, it } from "vitest";

import { cleanDatabasePerTest } from "./setup/database";
import { makeRecipe, makeUser } from "./setup/factories";

const db = cleanDatabasePerTest();

/**
 * The four constraint kinds Prisma's schema language cannot express, each
 * written by hand into migration SQL and tested here.
 *
 * These tests were written before the SQL and watched to fail. That matters
 * most for the deferrable constraint: a reorder test that passes against a
 * plain UNIQUE is testing nothing, and would look identical.
 */

describe("partial unique index: one current slug per recipe", () => {
  it("allows many historical slugs alongside one current", async () => {
    const recipe = await makeRecipe(db(), { slug: "current-name" });

    await db().recipeSlug.create({
      data: { slug: "old-name", recipeId: recipe.id, isCurrent: false },
    });
    await db().recipeSlug.create({
      data: { slug: "older-name", recipeId: recipe.id, isCurrent: false },
    });

    const all = await db().recipeSlug.findMany({ where: { recipeId: recipe.id } });
    expect(all).toHaveLength(3);
    expect(all.filter((s) => s.isCurrent)).toHaveLength(1);
  });

  it("refuses a second current slug for the same recipe", async () => {
    const recipe = await makeRecipe(db(), { slug: "current-name" });

    await expect(
      db().recipeSlug.create({
        data: { slug: "rival-name", recipeId: recipe.id, isCurrent: true },
      }),
    ).rejects.toThrow();
  });

  it("permits a rename inside one transaction", async () => {
    const recipe = await makeRecipe(db(), { slug: "before" });

    await db().$transaction(async (tx) => {
      await tx.recipeSlug.update({ where: { slug: "before" }, data: { isCurrent: false } });
      await tx.recipeSlug.create({
        data: { slug: "after", recipeId: recipe.id, isCurrent: true },
      });
    });

    const current = await db().recipeSlug.findFirst({
      where: { recipeId: recipe.id, isCurrent: true },
    });
    expect(current?.slug).toBe("after");
    expect(await db().recipeSlug.count({ where: { recipeId: recipe.id } })).toBe(2);
  });
});

describe("functional index: emails are unique case-insensitively", () => {
  it("treats Ada@example.com and ada@example.com as one person", async () => {
    await makeUser(db(), { email: "Ada@Example.com" });

    await expect(makeUser(db(), { email: "ada@example.com" })).rejects.toThrow();
  });

  it("still allows genuinely different addresses", async () => {
    await makeUser(db(), { email: "ada@example.com" });
    await makeUser(db(), { email: "grace@example.com" });

    expect(await db().user.count()).toBe(2);
  });
});

describe("deferrable constraints: positions can be swapped in a transaction", () => {
  it("swaps two step positions without tripping the unique constraint", async () => {
    const recipe = await makeRecipe(db(), { steps: ["first", "second", "third"] });

    // The intermediate state has two rows at position 0. A non-deferrable
    // UNIQUE rejects that even though the transaction ends valid.
    await db().$transaction(async (tx) => {
      await tx.recipeStep.updateMany({
        where: { recipeId: recipe.id, position: 1 },
        data: { position: 0 },
      });
      await tx.recipeStep.updateMany({
        where: { recipeId: recipe.id, position: 0, text: "first" },
        data: { position: 1 },
      });
    });

    const steps = await db().recipeStep.findMany({
      where: { recipeId: recipe.id },
      orderBy: { position: "asc" },
    });
    expect(steps.map((s) => s.text)).toEqual(["second", "first", "third"]);
  });

  it("reverses six steps in one statement per row", async () => {
    const recipe = await makeRecipe(db(), { steps: ["a", "b", "c", "d", "e", "f"] });
    const before = await db().recipeStep.findMany({
      where: { recipeId: recipe.id },
      orderBy: { position: "asc" },
    });

    await db().$transaction(
      before.map((step, index) =>
        db().recipeStep.update({
          where: { id: step.id },
          data: { position: before.length - 1 - index },
        }),
      ),
    );

    const after = await db().recipeStep.findMany({
      where: { recipeId: recipe.id },
      orderBy: { position: "asc" },
    });
    expect(after.map((s) => s.text)).toEqual(["f", "e", "d", "c", "b", "a"]);
  });

  it("still rejects a duplicate position that survives the commit", async () => {
    const recipe = await makeRecipe(db(), { steps: ["one", "two"] });

    // Deferred means checked at COMMIT, not never checked.
    await expect(
      db().$transaction(async (tx) => {
        await tx.recipeStep.updateMany({
          where: { recipeId: recipe.id, position: 1 },
          data: { position: 0 },
        });
      }),
    ).rejects.toThrow();
  });

  it("applies the same rule to ingredients", async () => {
    const recipe = await makeRecipe(db(), { ingredients: ["flour", "water"] });

    await db().$transaction(async (tx) => {
      await tx.recipeIngredient.updateMany({
        where: { recipeId: recipe.id, position: 1 },
        data: { position: 0 },
      });
      await tx.recipeIngredient.updateMany({
        where: { recipeId: recipe.id, position: 0, item: "flour" },
        data: { position: 1 },
      });
    });

    const items = await db().recipeIngredient.findMany({
      where: { recipeId: recipe.id },
      orderBy: { position: "asc" },
    });
    expect(items.map((i) => i.item)).toEqual(["water", "flour"]);
  });
});

describe("check constraints", () => {
  it("rejects a recipe published with no publish date", async () => {
    await expect(makeRecipe(db(), { status: "PUBLISHED", publishedAt: null })).rejects.toThrow();
  });

  it("rejects a draft that carries a publish date", async () => {
    await expect(
      makeRecipe(db(), { status: "DRAFT", publishedAt: new Date("2026-07-01T00:00:00.000Z") }),
    ).rejects.toThrow();
  });

  it("accepts the two consistent combinations", async () => {
    await makeRecipe(db(), { status: "DRAFT", publishedAt: null });
    await makeRecipe(db(), {
      status: "PUBLISHED",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(await db().recipe.count()).toBe(2);
  });

  it("rejects servings below one", async () => {
    await expect(makeRecipe(db(), { servings: 0 })).rejects.toThrow();
  });

  it("rejects a negative position", async () => {
    const recipe = await makeRecipe(db());
    await expect(
      db().recipeStep.create({ data: { recipeId: recipe.id, position: -1, text: "x" } }),
    ).rejects.toThrow();
  });
});
