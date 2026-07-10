import { describe, expect, it } from "vitest";

import type { RecipeInput } from "@/domain/recipe-input";
import { createRecipe, updateRecipe } from "@/server/recipes/commands";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeUser } from "./setup/factories";

/**
 * The writes behind the studio's two Server Actions.
 *
 * Against real Postgres because the interesting parts are not the columns:
 * a recipe and its first slug have to appear together or not at all, and the
 * slug has to be one nobody else holds. Neither is checkable without the
 * unique index and the transaction that this tier provides.
 */

const db = cleanDatabasePerTest();

function input(overrides: Partial<RecipeInput> = {}): RecipeInput {
  return {
    title: "Brown butter cardamom buns",
    summary: "Still working out the proving time.",
    body: "The second prove is the part that is not right yet.",
    heroImageUrl: null,
    servings: 12,
    prepMinutes: 60,
    cookMinutes: 20,
    difficulty: "HARD",
    ...overrides,
  };
}

describe("createRecipe", () => {
  it("writes the fields it was given", async () => {
    const author = await makeUser(db());

    const { id } = await createRecipe(db(), { authorId: author.id, input: input() });

    const row = await db().recipe.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe("Brown butter cardamom buns");
    expect(row.summary).toBe("Still working out the proving time.");
    expect(row.servings).toBe(12);
    expect(row.difficulty).toBe("HARD");
    expect(row.authorId).toBe(author.id);
  });

  it("starts a recipe as a draft with no publish date", async () => {
    const author = await makeUser(db());

    const { id } = await createRecipe(db(), { authorId: author.id, input: input() });

    // Publishing is a validated transition, not a field on the create form --
    // see `publish.ts`. Nothing here may produce a published recipe.
    const row = await db().recipe.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("DRAFT");
    expect(row.publishedAt).toBeNull();
  });

  it("gives it a slug made from its title", async () => {
    const author = await makeUser(db());

    const { id, slug } = await createRecipe(db(), { authorId: author.id, input: input() });

    expect(slug).toBe("brown-butter-cardamom-buns");
    const slugs = await db().recipeSlug.findMany({ where: { recipeId: id } });
    expect(slugs).toHaveLength(1);
    expect(slugs[0]?.isCurrent).toBe(true);
  });

  it("does not hand the same slug to a second recipe", async () => {
    const author = await makeUser(db());

    const first = await createRecipe(db(), { authorId: author.id, input: input() });
    const second = await createRecipe(db(), { authorId: author.id, input: input() });

    expect(first.slug).toBe("brown-butter-cardamom-buns");
    expect(second.slug).toBe("brown-butter-cardamom-buns-2");
  });

  it("avoids a slug another author already holds", async () => {
    const ada = await makeUser(db());
    const linus = await makeUser(db());
    await makePublishedRecipe(db(), { author: linus, slug: "cinnamon-buns" });

    const { slug } = await createRecipe(db(), {
      authorId: ada.id,
      input: input({ title: "Cinnamon buns" }),
    });

    // Slugs are globally unique -- the table's primary key is the slug itself
    // -- so this is not politeness, it is the only way the insert succeeds.
    expect(slug).toBe("cinnamon-buns-2");
  });

  it("finds a collision even when the title is long enough to be truncated", async () => {
    const author = await makeUser(db());
    // Long enough that the slug hits the 120-character cap, short enough to
    // fit the 160-character title column -- so the truncation under test is
    // the slug's, not the column's.
    const longTitle = `${"Cardamom ".repeat(14)}buns`;

    /*
     * **Three, and the third is the whole test.** A suffixed slug is
     * *shortened* to make room for the suffix, so it does not begin with the
     * full base. A lookup that searched for the base would still find the base
     * itself -- so the second create looks fine -- and would miss the suffixed
     * one, hand the same slug out again on the third, and die on the primary
     * key.
     *
     * Measured: with the prefix query replaced by the naive one, two creates
     * still pass and three do not.
     */
    const slugs: string[] = [];
    for (let n = 0; n < 3; n += 1) {
      slugs.push(
        (await createRecipe(db(), { authorId: author.id, input: input({ title: longTitle }) }))
          .slug,
      );
    }

    expect(new Set(slugs).size).toBe(3);
    expect(await db().recipeSlug.count()).toBe(3);
  });

  it("still produces a usable slug for a title with nothing sluggable in it", async () => {
    const author = await makeUser(db());

    const { slug } = await createRecipe(db(), {
      authorId: author.id,
      input: input({ title: "!!! ???" }),
    });

    expect(slug).toBe("recipe");
  });

  it("leaves nothing behind when the write fails", async () => {
    const author = await makeUser(db());

    // Past the column width. The Zod schema stops this long before here, which
    // is the point: this asserts what happens when something gets past it.
    await expect(
      createRecipe(db(), { authorId: author.id, input: input({ title: "a".repeat(300) }) }),
    ).rejects.toThrow();

    expect(await db().recipe.count()).toBe(0);
    expect(await db().recipeSlug.count()).toBe(0);
  });

  it("never leaves a recipe without a slug, even under a concurrent create", async () => {
    const author = await makeUser(db());

    /*
     * Two creates of the same title at once. Whether they interleave is up to
     * the scheduler, so the assertion is the invariant rather than the
     * outcome: each computes a slug from what it read, and the slug primary
     * key is what stops both writing the same one. A loser's transaction rolls
     * back whole -- no orphan recipe row.
     */
    const results = await Promise.allSettled([
      createRecipe(db(), { authorId: author.id, input: input() }),
      createRecipe(db(), { authorId: author.id, input: input() }),
    ]);

    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const recipes = await db().recipe.findMany({ select: { id: true } });
    const slugs = await db().recipeSlug.findMany({ where: { isCurrent: true } });
    expect(slugs).toHaveLength(recipes.length);
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(slugs.length);
  });
});

describe("updateRecipe", () => {
  it("changes the fields it was given", async () => {
    const author = await makeUser(db());
    const { id } = await createRecipe(db(), { authorId: author.id, input: input() });

    await updateRecipe(db(), { id, input: input({ title: "Cardamom knots", servings: 8 }) });

    const row = await db().recipe.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe("Cardamom knots");
    expect(row.servings).toBe(8);
  });

  it("clears a field the author emptied", async () => {
    const author = await makeUser(db());
    const { id } = await createRecipe(db(), { authorId: author.id, input: input() });

    await updateRecipe(db(), { id, input: input({ summary: null }) });

    // A form that only ever set values could never remove one, and the author
    // would have no way to take back a summary they no longer want.
    expect((await db().recipe.findUniqueOrThrow({ where: { id } })).summary).toBeNull();
  });

  it("does not move the URL when the title changes", async () => {
    const author = await makeUser(db());
    const { id, slug } = await createRecipe(db(), { authorId: author.id, input: input() });

    await updateRecipe(db(), { id, input: input({ title: "A completely different name" }) });

    /*
     * Renaming is Phase 15's, and it is a bigger question than it looks: the
     * old URL has to keep resolving, so a rename flips one slug row and
     * inserts another inside a transaction. Silently repointing the slug here
     * would break every link to the recipe with no redirect behind it.
     */
    const slugs = await db().recipeSlug.findMany({ where: { recipeId: id } });
    expect(slugs.map((s) => s.slug)).toEqual([slug]);
  });

  it("does not publish anything", async () => {
    const author = await makeUser(db());
    const { id } = await createRecipe(db(), { authorId: author.id, input: input() });

    await updateRecipe(db(), { id, input: input({ title: "Edited" }) });

    const row = await db().recipe.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("DRAFT");
    expect(row.publishedAt).toBeNull();
  });

  it("touches the edited timestamp", async () => {
    const author = await makeUser(db());
    const { id } = await createRecipe(db(), { authorId: author.id, input: input() });
    const before = (await db().recipe.findUniqueOrThrow({ where: { id } })).updatedAt;

    await updateRecipe(db(), { id, input: input({ title: "Edited" }) });

    // The dashboard sorts on this, so it has to actually move.
    const after = (await db().recipe.findUniqueOrThrow({ where: { id } })).updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
