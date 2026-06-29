import { describe, expect, it } from "vitest";

import { truncateAll, cleanDatabasePerTest } from "./setup/database";
import { makeRecipe } from "./setup/factories";

const db = cleanDatabasePerTest();

/**
 * Not a correctness test -- a recorded measurement.
 *
 * The choice of truncation over `migrate reset` between tests is the single
 * decision that determines whether this tier takes seconds or minutes, and it
 * gets re-litigated by anyone who has not seen the numbers. Putting the
 * measurement in the suite means the number is current rather than a claim in
 * a comment that was true once.
 *
 * The assertion is deliberately loose. A tight bound would fail on a slow
 * machine and teach everyone to ignore it; the point is that truncation is in
 * the milliseconds, not that it is in any particular millisecond.
 */
describe("per-test cleanup cost", () => {
  it("truncates a populated schema in well under a second", async () => {
    await makeRecipe(db(), {
      ingredients: ["a", "b", "c"],
      steps: ["one", "two", "three"],
    });
    await makeRecipe(db(), { ingredients: ["d"], steps: ["four"] });

    const runs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await makeRecipe(db(), { ingredients: ["x"], steps: ["y"] });
      const started = performance.now();
      await truncateAll(db());
      runs.push(performance.now() - started);
    }

    runs.sort((a, b) => a - b);
    const median = runs[Math.floor(runs.length / 2)] ?? Number.POSITIVE_INFINITY;

    console.log(`  truncate median: ${median.toFixed(1)} ms over ${runs.length} runs`);
    expect(median).toBeLessThan(500);

    // And it genuinely emptied everything.
    expect(await db().recipe.count()).toBe(0);
    expect(await db().user.count()).toBe(0);
    expect(await db().recipeIngredient.count()).toBe(0);
  });

  it("leaves the migration ledger alone", async () => {
    await truncateAll(db());
    const rows = await db().$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM _prisma_migrations
    `;
    // Truncating this would make the container look unmigrated to Prisma while
    // the tables were still there -- a confusing failure two phases later.
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });
});
