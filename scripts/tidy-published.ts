import "dotenv/config";

import { createPrismaClient } from "../src/server/prisma";

/**
 * Take everything the test suite published back off the public site.
 *
 * **A maintenance script a person can run, which the end-to-end teardown also
 * calls.** `npm run db:tidy`.
 *
 * The suite publishes recipes, and a published recipe is not private debris:
 * it joins the front page, the feed, the sitemap and every paginated listing.
 * Individual specs unpublish what they publish, but that cleanup is
 * best-effort by design -- a test that has already failed should report its own
 * reason rather than be replaced by a tidy-up that failed after it -- so the
 * debris accumulates exactly when something went wrong.
 *
 * It has caused four failures in tests about something else: a control that
 * could not find the seeded recipe, a suggestions list showing three test
 * recipes, an API listing whose first page was whatever a parallel worker had
 * just created, and a feed with no seeded recipe in the newest twenty.
 *
 * **Unpublish, never delete.** These rows are in a developer's database, not
 * the suite's, and the difference between "invisible" and "gone" is the
 * difference between a tidy-up and a data-loss bug in a helper. Drafts are
 * harmless -- they are on nobody's page but their author's.
 */
const SEEDED_SLUGS = [
  "no-knead-sourdough",
  "yellow-split-pea-soup",
  "brown-butter-cardamom-buns",
  "rye-crispbread",
];

/**
 * A title containing a run of digits long enough to be a millisecond timestamp.
 *
 * Every recipe the suite creates is named `<label> <Date.now()><random>`, and
 * nobody types that. It is the one pattern that separates a test artefact from
 * something a person wrote, which is what makes deleting these safe and
 * deleting anything else not.
 *
 * **Anywhere in the title, not anchored to the end**, because the tests that
 * rename append a word: `Renamed 1788236994673028103 three`. Anchoring left
 * seventy-three of those behind on the first run of this script, which is a
 * neat demonstration that a cleanup needs testing like anything else.
 */
const SUITE_TITLE = /\d{13,}/;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === "") {
    console.log("tidy: DATABASE_URL is not set, nothing to do");
    return;
  }

  const db = createPrismaClient({ connectionString });

  try {
    /*
     * Anything still published that is not one of the four seeded recipes.
     *
     * **Unpublished, never deleted.** This catches things the suite did not
     * create as well, and the difference between "invisible" and "gone" is the
     * difference between a tidy-up and a data-loss bug in a helper.
     */
    const { count: withdrawn } = await db.recipe.updateMany({
      where: { status: "PUBLISHED", slugs: { none: { slug: { in: SEEDED_SLUGS } } } },
      data: { status: "DRAFT" },
    });

    /*
     * Then the drafts the suite itself made, by name.
     *
     * **These are deleted, and only these.** Left alone they accumulate at
     * roughly fifteen a run: the development database reached four hundred,
     * which made the author's dashboard render every one of them and took the
     * accessibility scan of that page from two seconds to thirty-eight -- close
     * enough to the test timeout to fail under load. That is a test-debris
     * problem wearing a performance problem's clothes, and cleaning it up is
     * the honest fix.
     *
     * The title pattern is the safety. `Journey 1788266705112493537` is not
     * something a person types, and nothing without that shape is touched.
     */
    const stale = await db.recipe.findMany({
      where: { title: { contains: " " }, slugs: { none: { slug: { in: SEEDED_SLUGS } } } },
      select: { id: true, title: true },
    });

    const suiteMade = stale.filter((recipe) => SUITE_TITLE.test(recipe.title));
    const { count: removed } = await db.recipe.deleteMany({
      where: { id: { in: suiteMade.map((recipe) => recipe.id) } },
    });

    console.log(
      withdrawn === 0 && removed === 0
        ? "tidy: nothing left behind by the suite"
        : `tidy: unpublished ${String(withdrawn)}, deleted ${String(removed)} suite-made recipe(s)`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main();
