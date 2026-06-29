import { describe, expect, it } from "vitest";

import { countPublishedRecipes } from "@/server/recipes/queries";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeRecipe } from "./setup/factories";

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
