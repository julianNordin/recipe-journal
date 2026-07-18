import { describe, expect, it } from "vitest";

import { DEMO_PASSWORD, seedDatabase } from "../../prisma/seed-data";
import { authenticate } from "@/server/auth/authenticate";

import { cleanDatabasePerTest } from "./setup/database";

const db = cleanDatabasePerTest();

/**
 * The project's own date window, as inclusive bounds.
 *
 * Both spelled from inside it. The obvious upper bound is an exclusive
 * "the first of the following month", and writing that would put a date
 * outside the window into a tracked file -- one digit from a legitimate one,
 * and the single easiest thing to miss when grepping for strays.
 */
const WINDOW_OPENS = "2026-06-21";
const WINDOW_CLOSES = "2026-07-31T23:59:59.999Z";

/**
 * The seed, which Phase 05 asked for and did not get.
 *
 * It was only testable once `seedDatabase` took a client instead of building
 * one from `DATABASE_URL` -- the same change the query layer needed for the
 * same reason. Until then the idempotency claim was a comment in a file, and
 * two other comments cited it as though a test existed.
 *
 * It matters because the seed runs after every `migrate dev` and before every
 * end-to-end run. A seed that is not idempotent fails the second time, or
 * worse, quietly accumulates duplicates until something downstream is wrong
 * for reasons nobody connects back to here.
 */
describe("the development seed", () => {
  it("produces the fixture the rest of the suite assumes", async () => {
    const counts = await seedDatabase(db());

    expect(counts).toEqual({ users: 2, recipes: 4, published: 3, tags: 4 });
  });

  it("is idempotent: running it twice changes nothing", async () => {
    const first = await seedDatabase(db());
    const second = await seedDatabase(db());

    expect(second).toEqual(first);
  });

  it("does not duplicate children on a second run", async () => {
    // Counting recipes alone would miss this. The recipe rows are upserted on
    // their slug, but ingredients, steps and tag links are deleted and
    // recreated -- so a mistake there accumulates rows underneath a recipe
    // count that stays reassuringly at three.
    await seedDatabase(db());
    const after = async () => ({
      ingredients: await db().recipeIngredient.count(),
      steps: await db().recipeStep.count(),
      tagLinks: await db().recipeTag.count(),
      slugs: await db().recipeSlug.count(),
    });
    const first = await after();

    await seedDatabase(db());

    expect(await after()).toEqual(first);
  });

  it("keeps the same recipe rows rather than replacing them", async () => {
    // Upserted, not recreated. If the second run deleted and reinserted, the
    // ids would change -- and anything holding one, such as a comment or a
    // bookmarked studio URL, would be pointing at a recipe that no longer
    // exists.
    await seedDatabase(db());
    const before = (await db().recipe.findMany({ orderBy: { id: "asc" } })).map((r) => r.id);

    await seedDatabase(db());
    const after = (await db().recipe.findMany({ orderBy: { id: "asc" } })).map((r) => r.id);

    expect(after).toEqual(before);
  });

  it("leaves the demo accounts able to sign in, on both runs", async () => {
    // The end-to-end suite signs in as Ada, and it reseeds first. If a second
    // seed left the hash wrong, that suite would fail somewhere far from here.
    await seedDatabase(db());
    await seedDatabase(db());

    const user = await authenticate(db(), {
      email: "ada@example.com",
      password: DEMO_PASSWORD,
    });

    expect(user?.name).toBe("Ada Lindqvist");
    expect(user?.role).toBe("AUTHOR");
  });

  it("uses only dates inside the project's window", async () => {
    // A seed with `new Date()` in it would bake the real build date into the
    // fixture and make it different on every run.
    await seedDatabase(db());

    const recipes = await db().recipe.findMany({ select: { createdAt: true } });
    const users = await db().user.findMany({ select: { createdAt: true } });

    for (const { createdAt } of [...recipes, ...users]) {
      expect(createdAt.toISOString() >= WINDOW_OPENS).toBe(true);
      expect(createdAt.toISOString() <= WINDOW_CLOSES).toBe(true);
    }
  });
});
