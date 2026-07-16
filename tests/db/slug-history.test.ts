import { describe, expect, it } from "vitest";

import { publishRecipe, updateRecipe } from "@/server/recipes/commands";
import { moveCurrentSlug } from "@/server/recipes/slugs";

import { cleanDatabasePerTest } from "./setup/database";
import { makeRecipe, makeUser } from "./setup/factories";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Renaming a recipe, and what happens to the address it had.
 *
 * `recipe_slugs` is the single source of truth for every slug a recipe has
 * ever held, and `is_current` marks the live one -- so a rename is one row
 * flipped and one row written, inside a transaction, rather than a column
 * overwritten. That shape only earns its cost if the history is really kept
 * and really used, which is what most of this file is about.
 *
 * The last test races two renames at each other. `ux_recipe_slug_current` is
 * the partial unique index from phase 06, and this is the first thing in the
 * project with a production path that can actually put it under pressure.
 */

const db = cleanDatabasePerTest();

const slugsOf = async (client: PrismaClient, recipeId: string) =>
  (
    await client.recipeSlug.findMany({
      where: { recipeId },
      select: { slug: true, isCurrent: true },
      orderBy: { slug: "asc" },
    })
  ).map((row) => ({ slug: row.slug, current: row.isCurrent }));

/** The fields the recipe form always posts, so a test names only the title. */
const inputFor = (title: string) => ({
  title,
  summary: "A summary.",
  body: "An introduction.",
  heroImageUrl: null,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 20,
  difficulty: "MEDIUM" as const,
});

async function published(client: PrismaClient, title: string, slug: string) {
  const author = await makeUser(client);
  const recipe = await makeRecipe(client, {
    author,
    title,
    slug,
    summary: "A summary.",
    body: "An introduction.",
    ingredients: ["flour"],
    steps: ["Mix it."],
  });
  await publishRecipe(client, { id: recipe.id, now: new Date("2026-07-10T10:00:00.000Z") });
  return recipe;
}

describe("renaming a published recipe", () => {
  it("keeps the old address and marks the new one live", async () => {
    const recipe = await published(db(), "Rye loaf", "rye-loaf");

    const move = await updateRecipe(db(), {
      id: recipe.id,
      input: inputFor("Rye and caraway loaf"),
    });

    expect(move).toEqual({ slug: "rye-and-caraway-loaf", moved: true });
    expect(await slugsOf(db(), recipe.id)).toEqual([
      { slug: "rye-and-caraway-loaf", current: true },
      // Still there, and still owned by this recipe. Somebody has that URL.
      { slug: "rye-loaf", current: false },
    ]);
  });

  it("does nothing at all when the title has not changed", async () => {
    const recipe = await published(db(), "Rye loaf", "rye-loaf");

    const move = await updateRecipe(db(), { id: recipe.id, input: inputFor("Rye loaf") });

    /*
     * The test that stops a recipe colliding with itself. Without
     * `exceptRecipeId`, its own live slug reads as taken, `uniqueSlug` hands
     * back `rye-loaf-2`, and every save of an unedited form quietly changes the
     * recipe's address and adds a history row.
     */
    expect(move).toEqual({ slug: "rye-loaf", moved: false });
    expect(await slugsOf(db(), recipe.id)).toEqual([{ slug: "rye-loaf", current: true }]);
  });

  it("reclaims its own old address when renamed back", async () => {
    const recipe = await published(db(), "Rye loaf", "rye-loaf");

    await updateRecipe(db(), { id: recipe.id, input: inputFor("Caraway loaf") });
    await updateRecipe(db(), { id: recipe.id, input: inputFor("Rye loaf") });

    // Two rows, not three, and the original address is live again. A rename
    // that minted `rye-loaf-2` here would be permanent and invisible.
    expect(await slugsOf(db(), recipe.id)).toEqual([
      { slug: "caraway-loaf", current: false },
      { slug: "rye-loaf", current: true },
    ]);
  });

  it("does not take an address another recipe has ever held", async () => {
    const mine = await published(db(), "Rye loaf", "rye-loaf");
    const theirs = await published(db(), "Seeded rye", "seeded-rye");
    await updateRecipe(db(), { id: theirs.id, input: inputFor("Something else") });

    // `seeded-rye` is now history, and history still owns its slug.
    await updateRecipe(db(), { id: mine.id, input: inputFor("Seeded rye") });

    expect(await slugsOf(db(), mine.id)).toEqual([
      { slug: "rye-loaf", current: false },
      { slug: "seeded-rye-2", current: true },
    ]);
  });
});

describe("renaming a recipe that was never published", () => {
  it("replaces the old address instead of keeping it", async () => {
    const recipe = await makeRecipe(db(), { title: "First idea", slug: "first-idea" });

    await updateRecipe(db(), { id: recipe.id, input: inputFor("Second idea") });

    /*
     * **`publishedAt`, not `status`, decides this** -- it is set on the first
     * publish and never cleared, so it is the record of "this was public
     * once", which outlives an unpublish and is exactly the question being
     * asked. No URL that ever worked is broken here, and keeping the row would
     * reserve a slug nobody has seen every time an author reworded a draft.
     */
    expect(await slugsOf(db(), recipe.id)).toEqual([{ slug: "second-idea", current: true }]);
  });

  it("keeps the history once it has been published, even after unpublishing", async () => {
    const recipe = await published(db(), "Rye loaf", "rye-loaf");
    await db().recipe.update({ where: { id: recipe.id }, data: { status: "DRAFT" } });

    await updateRecipe(db(), { id: recipe.id, input: inputFor("Caraway loaf") });

    // The control on the test above: a draft that was once public is not the
    // same as a draft that never was, and only the second may forget an
    // address.
    expect(await slugsOf(db(), recipe.id)).toEqual([
      { slug: "caraway-loaf", current: true },
      { slug: "rye-loaf", current: false },
    ]);
  });
});

describe("two renames at once", () => {
  it("cannot leave a recipe with two live addresses", async () => {
    const recipe = await published(db(), "Rye loaf", "rye-loaf");

    let firstHasWritten: () => void = () => undefined;
    let letFirstCommit: () => void = () => undefined;
    const written = new Promise<void>((resolve) => (firstHasWritten = resolve));
    const held = new Promise<void>((resolve) => (letFirstCommit = resolve));

    /*
     * Two transactions on two connections, sequenced by hand so the race is
     * the one being tested rather than whichever one the scheduler happened to
     * run first.
     *
     * The first renames and then holds its transaction open. The second reads
     * the same live row, blocks on the first's lock, and is released when the
     * first commits -- at which point its own insert meets an index entry that
     * exists now and did not when it read.
     */
    const first = db().$transaction(
      async (tx) => {
        await moveCurrentSlug(tx, { recipeId: recipe.id, title: "Alpha loaf" });
        firstHasWritten();
        await held;
      },
      { timeout: 20_000 },
    );

    await written;

    const second = db().$transaction(
      async (tx) => {
        await moveCurrentSlug(tx, { recipeId: recipe.id, title: "Beta loaf" });
      },
      { timeout: 20_000 },
    );

    // Long enough for the second to reach the lock rather than the finish line.
    await new Promise((resolve) => setTimeout(resolve, 250));
    letFirstCommit();
    await first;

    // **The index refuses it, not the application.** Nothing in
    // `moveCurrentSlug` re-checks anything after the read, and nothing needs
    // to: the rule that a recipe has one live address is a fact about the
    // table, so the second writer loses whatever it believed at read time.
    await expect(second).rejects.toThrow(/ux_recipe_slug_current/);

    expect(await slugsOf(db(), recipe.id)).toEqual([
      { slug: "alpha-loaf", current: true },
      { slug: "rye-loaf", current: false },
    ]);
  });
});
