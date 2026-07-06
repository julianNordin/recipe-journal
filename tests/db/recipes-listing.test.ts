import { describe, expect, it } from "vitest";

import { findTagBySlug, listPublishedRecipes, listTags } from "@/server/recipes/queries";

import { cleanDatabasePerTest, seqScanOnlyDb } from "./setup/database";
import { makePublishedRecipe, makeRecipe, makeUser } from "./setup/factories";

const db = cleanDatabasePerTest();

const AT = (iso: string) => new Date(iso);

/** Three published recipes, newest last in this array. */
async function seedThree() {
  await makePublishedRecipe(db(), {
    slug: "oldest",
    title: "Oldest",
    publishedAt: AT("2026-06-22T10:00:00.000Z"),
  });
  await makePublishedRecipe(db(), {
    slug: "middle",
    title: "Middle",
    publishedAt: AT("2026-07-01T10:00:00.000Z"),
  });
  await makePublishedRecipe(db(), {
    slug: "newest",
    title: "Newest",
    publishedAt: AT("2026-07-20T10:00:00.000Z"),
  });
}

const titles = (result: { items: { title: string }[] }): string[] =>
  result.items.map((item) => item.title);

describe("listPublishedRecipes", () => {
  it("is empty on an empty database", async () => {
    expect(await listPublishedRecipes(db(), { skip: 0, take: 10 })).toEqual({
      items: [],
      total: 0,
    });
  });

  it("returns published recipes newest first", async () => {
    await seedThree();

    expect(titles(await listPublishedRecipes(db(), { skip: 0, take: 10 }))).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  it("leaves drafts out", async () => {
    await seedThree();
    await makeRecipe(db(), { slug: "a-draft", title: "A draft" });

    const result = await listPublishedRecipes(db(), { skip: 0, take: 10 });

    expect(titles(result)).not.toContain("A draft");
    expect(result.total).toBe(3);
  });

  it("pages with skip and take", async () => {
    await seedThree();

    expect(titles(await listPublishedRecipes(db(), { skip: 0, take: 2 }))).toEqual([
      "Newest",
      "Middle",
    ]);
    expect(titles(await listPublishedRecipes(db(), { skip: 2, take: 2 }))).toEqual(["Oldest"]);
    expect(titles(await listPublishedRecipes(db(), { skip: 99, take: 2 }))).toEqual([]);
  });

  it("reports the total for the whole filter, not the page", async () => {
    // The pager needs to know there is a page 2. Returning items.length here
    // would render a pager that always claims to be on the last page.
    await seedThree();

    const result = await listPublishedRecipes(db(), { skip: 0, take: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it("pages without dropping or repeating a recipe when publish dates tie", async () => {
    // Three recipes published in the same instant. With only `publishedAt` to
    // sort by, their relative order is unspecified -- and offset paging asks a
    // separate question per page, so an order that changes between the
    // questions shows one recipe twice and never shows another.
    const at = AT("2026-07-04T09:00:00.000Z");
    for (const title of ["Tie A", "Tie B", "Tie C"]) {
      await makePublishedRecipe(db(), { title, publishedAt: at });
    }

    // Read through the seq-scan client, so the answer comes from the heap
    // rather than from an index that would impose an order of its own.
    const first = await listPublishedRecipes(seqScanOnlyDb(), { skip: 0, take: 1 });

    // Somebody edits a recipe between page views -- an ordinary thing for a
    // site with authors on it. Postgres writes an UPDATE as a new tuple at the
    // end of the heap, so the next sequential scan sees a different order than
    // the last one did. That is the moment an untied sort loses a row.
    await db().recipe.updateMany({
      where: { title: "Tie A" },
      data: { summary: "edited between page views" },
    });

    const second = await listPublishedRecipes(seqScanOnlyDb(), { skip: 1, take: 1 });
    const third = await listPublishedRecipes(seqScanOnlyDb(), { skip: 2, take: 1 });

    const seen = [...titles(first), ...titles(second), ...titles(third)];
    expect(new Set(seen).size, `paging returned ${JSON.stringify(seen)}`).toBe(3);
    expect([...seen].sort()).toEqual(["Tie A", "Tie B", "Tie C"]);
  });

  it("filters by tag", async () => {
    await seedThree();
    const bread = await db().tag.create({ data: { slug: "bread", name: "Bread" } });
    const oldest = await db().recipeSlug.findUniqueOrThrow({ where: { slug: "oldest" } });
    await db().recipeTag.create({ data: { recipeId: oldest.recipeId, tagId: bread.id } });

    const result = await listPublishedRecipes(db(), { skip: 0, take: 10, tagSlug: "bread" });

    expect(titles(result)).toEqual(["Oldest"]);
    expect(result.total).toBe(1);
  });

  it("returns nothing for a tag nobody uses", async () => {
    await seedThree();
    await db().tag.create({ data: { slug: "unused", name: "Unused" } });

    expect(await listPublishedRecipes(db(), { skip: 0, take: 10, tagSlug: "unused" })).toEqual({
      items: [],
      total: 0,
    });
  });

  it("carries the slug, author and tags each card needs", async () => {
    const author = await makeUser(db(), { name: "Ada" });
    const recipe = await makePublishedRecipe(db(), {
      slug: "carrot-cake",
      title: "Carrot cake",
      author,
    });
    const tag = await db().tag.create({ data: { slug: "cake", name: "Cake" } });
    await db().recipeTag.create({ data: { recipeId: recipe.id, tagId: tag.id } });

    const [item] = (await listPublishedRecipes(db(), { skip: 0, take: 10 })).items;

    expect(item).toMatchObject({
      slug: "carrot-cake",
      title: "Carrot cake",
      author: { name: "Ada" },
      tags: [{ slug: "cake", name: "Cake" }],
    });
    expect(item).not.toHaveProperty("body");
  });

  it("skips a recipe that has no current slug", async () => {
    // It has no URL, so a card linking to it would link nowhere. The partial
    // unique index allows at most one current slug per recipe; it does not
    // require one, and this is what that gap looks like from the list.
    const orphan = await makePublishedRecipe(db(), { slug: "was-current", title: "Orphan" });
    await db().recipeSlug.updateMany({
      where: { recipeId: orphan.id },
      data: { isCurrent: false },
    });
    await makePublishedRecipe(db(), { slug: "fine", title: "Fine" });

    expect(titles(await listPublishedRecipes(db(), { skip: 0, take: 10 }))).toEqual(["Fine"]);
  });
});

describe("listTags", () => {
  it("is empty on an empty database", async () => {
    expect(await listTags(db())).toEqual([]);
  });

  it("lists tags alphabetically with how many published recipes carry them", async () => {
    const soup = await db().tag.create({ data: { slug: "soup", name: "Soup" } });
    const bread = await db().tag.create({ data: { slug: "bread", name: "Bread" } });

    const one = await makePublishedRecipe(db(), { slug: "r1" });
    const two = await makePublishedRecipe(db(), { slug: "r2" });
    await db().recipeTag.createMany({
      data: [
        { recipeId: one.id, tagId: bread.id },
        { recipeId: two.id, tagId: bread.id },
        { recipeId: two.id, tagId: soup.id },
      ],
    });

    expect(await listTags(db())).toEqual([
      { slug: "bread", name: "Bread", recipeCount: 2 },
      { slug: "soup", name: "Soup", recipeCount: 1 },
    ]);
  });

  it("does not count a draft towards a tag", async () => {
    const bread = await db().tag.create({ data: { slug: "bread", name: "Bread" } });
    const published = await makePublishedRecipe(db(), { slug: "pub" });
    const draft = await makeRecipe(db(), { slug: "draft" });
    await db().recipeTag.createMany({
      data: [
        { recipeId: published.id, tagId: bread.id },
        { recipeId: draft.id, tagId: bread.id },
      ],
    });

    expect(await listTags(db())).toEqual([{ slug: "bread", name: "Bread", recipeCount: 1 }]);
  });

  it("omits a tag that only a draft uses", async () => {
    // Listing it would offer a link to a page with nothing on it, and would
    // also disclose that some unpublished recipe exists under that tag.
    const secret = await db().tag.create({ data: { slug: "secret", name: "Secret" } });
    const draft = await makeRecipe(db(), { slug: "draft" });
    await db().recipeTag.create({ data: { recipeId: draft.id, tagId: secret.id } });

    expect(await listTags(db())).toEqual([]);
  });
});

describe("findTagBySlug", () => {
  it("finds a tag", async () => {
    await db().tag.create({ data: { slug: "bread", name: "Bread" } });

    expect(await findTagBySlug(db(), "bread")).toEqual({ slug: "bread", name: "Bread" });
  });

  it("returns null for a slug nobody has", async () => {
    expect(await findTagBySlug(db(), "nope")).toBeNull();
  });
});
