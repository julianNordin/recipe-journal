import { describe, expect, it } from "vitest";

import { publishRecipe, unpublishRecipe } from "@/server/recipes/commands";

import { cleanDatabasePerTest } from "./setup/database";
import { makeRecipe, makeUser } from "./setup/factories";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Publishing, against the database that enforces half of it.
 *
 * The policy -- what counts as complete enough -- is pure and unit-tested in
 * `src/domain/publish.ts`. What needs real Postgres is the pair of statements
 * that carry it out, because `ck_recipes_published_has_date` is checked between them
 * and their order is the only thing that satisfies it.
 *
 * The date is the subject of most of these. **`publishedAt` is set once and
 * never moved**, which means a recipe pulled down to fix a typo keeps its
 * place in the archive when it goes back up. That is a rule with no natural
 * home in a form and no way to be noticed by hand: nothing looks wrong the day
 * it breaks, and the evidence is gone by the time anyone asks.
 */

const db = cleanDatabasePerTest();

/** A draft with everything the rules ask for, so publishing it should succeed. */
async function completeDraft(client: PrismaClient) {
  const author = await makeUser(client);
  return makeRecipe(client, {
    author,
    title: "Complete enough",
    summary: "It has a summary.",
    body: "And an introduction.",
    ingredients: ["flour"],
    steps: ["Mix it."],
  });
}

const statusOf = (client: PrismaClient, id: string) =>
  client.recipe.findUniqueOrThrow({
    where: { id },
    select: { status: true, publishedAt: true },
  });

describe("publishRecipe", () => {
  it("moves a complete draft to published, and stamps it", async () => {
    const recipe = await completeDraft(db());
    const now = new Date("2026-07-15T09:30:00.000Z");

    expect(await publishRecipe(db(), { id: recipe.id, now })).toEqual({ ok: true });

    expect(await statusOf(db(), recipe.id)).toEqual({ status: "PUBLISHED", publishedAt: now });
  });

  it("refuses an incomplete recipe and changes nothing", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author, summary: null, body: "", steps: [] });

    const result = await publishRecipe(db(), { id: recipe.id, now: new Date() });

    // Every problem at once. One at a time means the author fixes, saves, and
    // is told about the next -- four round trips for four omissions.
    expect(result).toEqual({
      ok: false,
      problems: ["missing-summary", "missing-body", "no-ingredients", "no-steps"],
    });
    expect(await statusOf(db(), recipe.id)).toEqual({ status: "DRAFT", publishedAt: null });
  });

  it("refuses a recipe with ingredients but no steps", async () => {
    const recipe = await makeRecipe(db(), {
      summary: "Has one.",
      body: "Has one.",
      ingredients: ["flour"],
    });

    // The control on the test above, which fails four rules at once and so
    // cannot show that any single one of them is being evaluated.
    expect(await publishRecipe(db(), { id: recipe.id, now: new Date() })).toEqual({
      ok: false,
      problems: ["no-steps"],
    });
  });

  it("does not move the date when a published recipe is published again", async () => {
    const recipe = await completeDraft(db());
    const first = new Date("2026-07-15T09:30:00.000Z");
    const later = new Date("2026-07-28T18:00:00.000Z");

    await publishRecipe(db(), { id: recipe.id, now: first });
    await publishRecipe(db(), { id: recipe.id, now: later });

    /*
     * **The `WHERE publishedAt IS NULL` on the first statement is what makes
     * this true, and it is a database condition rather than a value computed
     * from the read above it.** Deleting that clause passes every other test
     * in this file and fails this one, which is the entire reason it is here.
     */
    expect((await statusOf(db(), recipe.id)).publishedAt).toEqual(first);
  });
});

describe("unpublishRecipe", () => {
  it("returns a recipe to draft", async () => {
    const recipe = await completeDraft(db());
    await publishRecipe(db(), { id: recipe.id, now: new Date("2026-07-15T09:30:00.000Z") });

    await unpublishRecipe(db(), { id: recipe.id });

    expect((await statusOf(db(), recipe.id)).status).toBe("DRAFT");
  });

  it("keeps the publish date, so republishing restores it", async () => {
    const recipe = await completeDraft(db());
    const first = new Date("2026-07-15T09:30:00.000Z");

    await publishRecipe(db(), { id: recipe.id, now: first });
    await unpublishRecipe(db(), { id: recipe.id });

    // A draft carrying a date is not an inconsistency -- it is the record of
    // when this was last public, and `ck_recipes_published_has_date` was relaxed to a
    // one-directional check in phase 07 precisely so it can exist.
    expect((await statusOf(db(), recipe.id)).publishedAt).toEqual(first);

    await publishRecipe(db(), { id: recipe.id, now: new Date("2026-07-30T08:00:00.000Z") });

    // Back up, in its original place in the archive. Without this the fix of a
    // typo silently reorders the site and the original date is unrecoverable.
    expect(await statusOf(db(), recipe.id)).toEqual({ status: "PUBLISHED", publishedAt: first });
  });

  it("leaves a recipe that was never published with no date at all", async () => {
    const recipe = await completeDraft(db());

    await unpublishRecipe(db(), { id: recipe.id });

    // The control: "keeps the date" must not mean "invents one".
    expect(await statusOf(db(), recipe.id)).toEqual({ status: "DRAFT", publishedAt: null });
  });
});
