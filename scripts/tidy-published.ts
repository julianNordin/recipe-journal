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

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === "") {
    console.log("tidy: DATABASE_URL is not set, nothing to do");
    return;
  }

  const db = createPrismaClient({ connectionString });

  try {
    const { count } = await db.recipe.updateMany({
      where: { status: "PUBLISHED", slugs: { none: { slug: { in: SEEDED_SLUGS } } } },
      data: { status: "DRAFT" },
    });

    console.log(
      count === 0
        ? "tidy: nothing left published by the suite"
        : `tidy: unpublished ${String(count)} recipe(s)`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main();
