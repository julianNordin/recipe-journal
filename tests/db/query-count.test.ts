import { describe, expect, it } from "vitest";

import { listPublishedRecipes } from "@/server/recipes/queries";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeUser } from "./setup/factories";
import { countingClient } from "./setup/query-counter";

import type { PrismaClient, User } from "@/generated/prisma/client";

/**
 * How many times listing recipes asks the database anything.
 *
 * **The assertion is that five recipes and ten cost the same, never that the
 * cost is some particular number.** A test asserting "seven queries" passes
 * for the wrong reason the day somebody adds a column, and fails for no reason
 * the day somebody adds a legitimate one. What matters is the shape of the
 * curve: constant is fine at any height, and linear is the bug.
 */

const db = cleanDatabasePerTest();

async function seedRecipes(client: PrismaClient, count: number, author: User) {
  for (let i = 0; i < count; i += 1) {
    const recipe = await makePublishedRecipe(client, {
      author,
      title: `Recipe ${String(i)}`,
      slug: `recipe-${String(i)}`,
    });

    // Two comments each, so the count on a card is a number worth fetching
    // rather than always zero.
    await client.comment.createMany({
      data: [
        { recipeId: recipe.id, authorId: author.id, body: "One." },
        { recipeId: recipe.id, authorId: author.id, body: "Two." },
      ],
    });
  }
}

describe("listing recipes", () => {
  it("costs the same for ten recipes as for five", async () => {
    const author = await makeUser(db());
    await seedRecipes(db(), 10, author);

    const counter = countingClient(db());

    counter.reset();
    const five = await listPublishedRecipes(counter.client, { skip: 0, take: 5 });
    const forFive = counter.count();

    counter.reset();
    const ten = await listPublishedRecipes(counter.client, { skip: 0, take: 10 });
    const forTen = counter.count();

    // The control: the two calls really did return different amounts of work.
    expect(five.items).toHaveLength(5);
    expect(ten.items).toHaveLength(10);

    expect(forTen, `five cost ${String(forFive)}, ten cost ${String(forTen)}`).toBe(forFive);
  });

  it("returns the comment count it was asked for", async () => {
    const author = await makeUser(db());
    await seedRecipes(db(), 2, author);

    const page = await listPublishedRecipes(db(), { skip: 0, take: 5 });

    // The control on the test above. A listing that stopped fetching comment
    // counts altogether would cost the same for five and for ten, and would
    // pass it for the wrong reason.
    expect(page.items.map((item) => item.commentCount)).toEqual([2, 2]);
  });

  it("costs the same whether or not the recipes have comments", async () => {
    const author = await makeUser(db());
    await makePublishedRecipe(db(), { author, slug: "quiet-one" });
    await makePublishedRecipe(db(), { author, slug: "quiet-two" });

    const counter = countingClient(db());
    counter.reset();
    await listPublishedRecipes(counter.client, { skip: 0, take: 5 });
    const withoutComments = counter.count();

    await db().comment.createMany({
      data: (await db().recipe.findMany({ select: { id: true } })).map((recipe) => ({
        recipeId: recipe.id,
        authorId: author.id,
        body: "Something.",
      })),
    });

    counter.reset();
    await listPublishedRecipes(counter.client, { skip: 0, take: 5 });

    // An aggregate, not a lookup per row that happens to be skipped when there
    // is nothing to look up.
    expect(counter.count()).toBe(withoutComments);
  });
});
