import { describe, expect, it } from "vitest";

import { listRecipesByAuthor } from "@/server/recipes/queries";

import { cleanDatabasePerTest, seqScanOnlyDb } from "./setup/database";
import { makePublishedRecipe, makeRecipe, makeUser } from "./setup/factories";

/**
 * What an author sees on their own dashboard.
 *
 * The difference from `listPublishedRecipes` is the whole point of the
 * function: this one is scoped to one author and includes their drafts, so
 * "whose recipes come back" is the assertion that matters most. Everything
 * else on the studio is reached from this list.
 */

const db = cleanDatabasePerTest();

describe("listRecipesByAuthor", () => {
  it("returns nothing for an author who has written nothing", async () => {
    const author = await makeUser(db());

    expect(await listRecipesByAuthor(db(), author.id)).toEqual([]);
  });

  it("returns the author's drafts as well as their published recipes", async () => {
    const author = await makeUser(db());
    await makeRecipe(db(), { author, title: "A draft" });
    await makePublishedRecipe(db(), { author, title: "Published" });

    const items = await listRecipesByAuthor(db(), author.id);

    expect(items.map((r) => r.title).sort()).toEqual(["A draft", "Published"]);
    expect(items.map((r) => r.status).sort()).toEqual(["DRAFT", "PUBLISHED"]);
  });

  it("returns nobody else's recipes", async () => {
    const ada = await makeUser(db());
    const linus = await makeUser(db());
    await makeRecipe(db(), { author: ada, title: "Ada's draft" });
    await makePublishedRecipe(db(), { author: linus, title: "Linus's published" });
    await makeRecipe(db(), { author: linus, title: "Linus's draft" });

    // The dashboard is the one page where a draft is deliberately visible, so
    // it is also the one place where scoping by author is doing real work
    // rather than repeating what `status` already decided.
    const items = await listRecipesByAuthor(db(), ada.id);

    expect(items.map((r) => r.title)).toEqual(["Ada's draft"]);
  });

  it("carries the current slug", async () => {
    const author = await makeUser(db());
    await makePublishedRecipe(db(), { author, slug: "current-one" });

    expect((await listRecipesByAuthor(db(), author.id))[0]?.slug).toBe("current-one");
  });

  it("ignores a slug the recipe used to have", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author, slug: "the-old-name" });
    await db().recipeSlug.update({
      where: { slug: "the-old-name" },
      data: { isCurrent: false },
    });
    await db().recipeSlug.create({
      data: { slug: "the-new-name", recipeId: recipe.id, isCurrent: true },
    });

    expect((await listRecipesByAuthor(db(), author.id))[0]?.slug).toBe("the-new-name");
  });

  it("still lists a recipe that has no slug at all", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author, title: "Unreachable otherwise" });
    await db().recipeSlug.deleteMany({ where: { recipeId: recipe.id } });

    /*
     * **The opposite of what the public list does, and deliberately.**
     * `listPublishedRecipes` drops a recipe with no current slug because a
     * card for it would link nowhere. The studio links by id, so dropping it
     * here would make the recipe permanently unreachable by the only person
     * who could fix it.
     */
    const items = await listRecipesByAuthor(db(), author.id);

    expect(items.map((r) => r.title)).toEqual(["Unreachable otherwise"]);
    expect(items[0]?.slug).toBeNull();
  });
});

describe("the order the dashboard shows them in", () => {
  it("puts the most recently edited first", async () => {
    const author = await makeUser(db());

    // Written in an order that is not the answer, so the heap cannot supply
    // the sort by accident.
    await makeRecipe(db(), {
      author,
      title: "middle",
      updatedAt: new Date("2026-07-08T10:00:00Z"),
    });
    await makeRecipe(db(), {
      author,
      title: "newest",
      updatedAt: new Date("2026-07-14T10:00:00Z"),
    });
    await makeRecipe(db(), {
      author,
      title: "oldest",
      updatedAt: new Date("2026-07-02T10:00:00Z"),
    });

    /*
     * Read through the client that may not use an index. Without it this
     * assertion is decoration -- see gotcha 52: an index on the filtered
     * column hands back sorted rows having never been asked to, and deleting
     * the `orderBy` changes no test result.
     */
    const items = await listRecipesByAuthor(seqScanOnlyDb(), author.id);

    // Positive control: the same rows, unsorted, arrive in insertion order.
    // If a later edit stops the fixture being adversarial, this fails here
    // rather than quietly hollowing out the line below.
    const heapOrder = await seqScanOnlyDb().$queryRawUnsafe<{ title: string }[]>(
      `SELECT title FROM recipes WHERE author_id = '${author.id}'`,
    );
    expect(heapOrder.map((r) => r.title)).toEqual(["middle", "newest", "oldest"]);

    expect(items.map((r) => r.title)).toEqual(["newest", "middle", "oldest"]);
  });

  it("breaks a tie rather than leaving it to the heap", async () => {
    const author = await makeUser(db());
    const sameInstant = new Date("2026-07-11T09:00:00.000Z");

    await makeRecipe(db(), { author, title: "tie a", updatedAt: sameInstant });
    await makeRecipe(db(), { author, title: "tie b", updatedAt: sameInstant });
    await makeRecipe(db(), { author, title: "tie c", updatedAt: sameInstant });

    // Same lesson as the public listing: an order that is not total is an
    // order that can change between two identical requests. The ids are uuid
    // v7, so the tiebreak agrees with the intent of the sort.
    const first = (await listRecipesByAuthor(seqScanOnlyDb(), author.id)).map((r) => r.title);
    const second = (await listRecipesByAuthor(seqScanOnlyDb(), author.id)).map((r) => r.title);

    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
  });
});
