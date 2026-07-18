import type { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";

export type SeedCounts = {
  users: number;
  recipes: number;
  published: number;
  tags: number;
};

/**
 * Development seed.
 *
 * **Takes a client rather than building one**, for the same reason the query
 * layer does (see `src/server/recipes/queries.ts`): a module that constructs
 * its own connection from `DATABASE_URL` can only ever be run, never tested.
 * The script in `seed.ts` passes the development client; the database tier
 * passes one pointed at a throwaway container, which is what lets the
 * idempotency claim below be a test instead of a comment.
 *
 * Idempotent: every write is keyed on something stable -- tags on their slug,
 * users on their email, recipes on their slug -- so running it twice is a
 * no-op rather than a duplicate-key error. That matters because it runs after
 * every `migrate dev` and before every end-to-end run.
 *
 * Every date here is fixed and inside the project's own window. Seed data with
 * `new Date()` in it produces a different fixture on every run, which makes
 * snapshot-style assertions flap and bakes the real build date into the
 * repository.
 */

/** Fixed instants, so the fixture is identical on every run. */
const AT = {
  ada: new Date("2026-06-22T09:14:00.000Z"),
  linus: new Date("2026-06-23T18:02:00.000Z"),
  sourdough: new Date("2026-06-24T07:40:00.000Z"),
  crispbread: new Date("2026-06-28T15:05:00.000Z"),
  soup: new Date("2026-07-02T16:25:00.000Z"),
  draft: new Date("2026-07-06T11:10:00.000Z"),
} as const;

/**
 * The demo password, in the clear and on purpose.
 *
 * Seeded accounts exist so the project can be cloned and signed into. A secret
 * nobody is told is the same as no account at all, and inventing a random one
 * per run would mean reading it out of the database to use it.
 */
export const DEMO_PASSWORD = "recipe-journal-demo";

const TAGS = [
  { slug: "bread", name: "Bread" },
  { slug: "soup", name: "Soup" },
  { slug: "weeknight", name: "Weeknight" },
  { slug: "vegetarian", name: "Vegetarian" },
] as const;

export async function seedDatabase(db: PrismaClient): Promise<SeedCounts> {
  // --- Tags ---------------------------------------------------------------
  for (const tag of TAGS) {
    await db.tag.upsert({ where: { slug: tag.slug }, update: { name: tag.name }, create: tag });
  }

  // --- Authors ------------------------------------------------------------
  /*
   * Both demo accounts share one password, printed at the end of the run.
   *
   * It is hashed with the same argon2id parameters the application uses, so
   * signing in as a seeded author exercises the real verification path rather
   * than a shortcut around it. `update` sets the hash too, so an existing
   * database from before phase 10 gains one on the next seed instead of
   * quietly staying unable to sign in.
   *
   * These are throwaway accounts on example.com with a password written down
   * in a public repository. That is the point -- a reviewer should be able to
   * clone this, seed it and sign in, without an OAuth app or an invitation.
   */
  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);

  const ada = await db.user.upsert({
    where: { email: "ada@example.com" },
    update: { passwordHash: demoPasswordHash },
    create: {
      email: "ada@example.com",
      name: "Ada Lindqvist",
      role: "AUTHOR",
      passwordHash: demoPasswordHash,
      createdAt: AT.ada,
    },
  });

  const linus = await db.user.upsert({
    where: { email: "linus@example.com" },
    update: { passwordHash: demoPasswordHash },
    create: {
      email: "linus@example.com",
      name: "Linus Berg",
      role: "AUTHOR",
      passwordHash: demoPasswordHash,
      createdAt: AT.linus,
    },
  });

  // --- Recipes ------------------------------------------------------------
  await seedRecipe(db, {
    slug: "no-knead-sourdough",
    authorId: ada.id,
    at: AT.sourdough,
    status: "PUBLISHED",
    title: "No-knead sourdough",
    summary: "A long, slow ferment that does the work while you do not.",
    body: "The dough is wet enough that gluten develops on its own given time.\n\nStart it the night before.",
    servings: 8,
    prepMinutes: 30,
    cookMinutes: 45,
    difficulty: "MEDIUM",
    tags: ["bread", "vegetarian"],
    ingredients: [
      { quantity: "500", unit: "g", item: "strong white flour" },
      { quantity: "375", unit: "g", item: "water", note: "at room temperature" },
      { quantity: "100", unit: "g", item: "active starter" },
      { quantity: "10", unit: "g", item: "fine salt" },
    ],
    steps: [
      "Mix flour and water and rest for one hour.",
      "Add starter and salt, folding until incorporated.",
      "Fold every thirty minutes for three hours.",
      "Shape, then refrigerate overnight.",
      "Bake at 250C covered for twenty minutes, then uncovered for twenty-five.",
    ],
  });

  /*
   * Linus's second published recipe, and both halves of that are deliberate.
   *
   * **Second**, because the detail page suggests other recipes by the same
   * cook inside the only Suspense boundary in the application -- and a seed
   * where every author has exactly one published recipe makes that section
   * render nothing, so the one thing phase 16 built to stream would never be
   * exercised by a test.
   *
   * **Linus's**, because the end-to-end suite signs in as Ada and publishes
   * recipes of its own. Those carry today's date, so they sort ahead of
   * anything seeded and crowd a "latest three" list. The fixture for a test
   * that depends on ordering belongs to the author the suite never writes as.
   */
  await seedRecipe(db, {
    slug: "rye-crispbread",
    authorId: linus.id,
    at: AT.crispbread,
    status: "PUBLISHED",
    title: "Rye crispbread",
    summary: "Rolled thin, docked all over, and baked until it snaps.",
    body: "Roll it thinner than feels sensible. It should be brittle, not chewy.",
    servings: 12,
    prepMinutes: 25,
    cookMinutes: 12,
    difficulty: "EASY",
    tags: ["bread", "vegetarian"],
    ingredients: [
      { quantity: "250", unit: "g", item: "wholemeal rye flour" },
      { quantity: "150", unit: "g", item: "water", note: "warm" },
      { quantity: "5", unit: "g", item: "fine salt" },
    ],
    steps: [
      "Mix to a stiff dough and rest for twenty minutes.",
      "Roll out as thinly as the dough allows, then dock it all over.",
      "Bake at 200C until dry and snapping, about twelve minutes.",
    ],
  });

  await seedRecipe(db, {
    slug: "yellow-split-pea-soup",
    authorId: linus.id,
    at: AT.soup,
    status: "PUBLISHED",
    title: "Yellow split pea soup",
    summary: "Thursday, as it has been for several centuries.",
    body: "Soak the peas properly and this needs almost no attention.",
    servings: 6,
    prepMinutes: 15,
    cookMinutes: 90,
    difficulty: "EASY",
    tags: ["soup", "weeknight"],
    ingredients: [
      { quantity: "500", unit: "g", item: "yellow split peas", note: "soaked overnight" },
      { quantity: "1", item: "onion", note: "diced" },
      { quantity: "2", unit: "tsp", item: "dried marjoram" },
    ],
    steps: [
      "Drain the peas and cover with fresh water.",
      "Simmer for one hour, skimming the surface.",
      "Add the onion and marjoram and cook for thirty minutes more.",
    ],
  });

  // A draft, owned by Ada. Phase 14's authorization tests need one that
  // belongs to a specific author and is invisible to everyone else.
  await seedRecipe(db, {
    slug: "brown-butter-cardamom-buns",
    authorId: ada.id,
    at: AT.draft,
    status: "DRAFT",
    title: "Brown butter cardamom buns",
    summary: "Still working out the proving time.",
    body: "Draft. The second prove is the part that is not right yet.",
    servings: 12,
    prepMinutes: 60,
    cookMinutes: 20,
    difficulty: "HARD",
    tags: ["bread"],
    ingredients: [{ quantity: "600", unit: "g", item: "plain flour" }],
    steps: ["Brown the butter and let it cool completely."],
  });

  const counts = {
    users: await db.user.count(),
    recipes: await db.recipe.count(),
    published: await db.recipe.count({ where: { status: "PUBLISHED" } }),
    tags: await db.tag.count(),
  };
  return counts;
}

type SeedRecipe = {
  slug: string;
  authorId: string;
  at: Date;
  status: "DRAFT" | "PUBLISHED";
  title: string;
  summary: string;
  body: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  tags: string[];
  ingredients: { quantity?: string; unit?: string; item: string; note?: string }[];
  steps: string[];
};

/**
 * Keyed on the slug, which is the only stable identifier a seed has -- ids are
 * generated. Children are replaced wholesale rather than diffed, because the
 * seed is a fixture, not a migration.
 */
async function seedRecipe(db: PrismaClient, input: SeedRecipe) {
  const existing = await db.recipeSlug.findUnique({ where: { slug: input.slug } });

  const data = {
    title: input.title,
    summary: input.summary,
    body: input.body,
    servings: input.servings,
    prepMinutes: input.prepMinutes,
    cookMinutes: input.cookMinutes,
    difficulty: input.difficulty,
    status: input.status,
    publishedAt: input.status === "PUBLISHED" ? input.at : null,
    createdAt: input.at,
    authorId: input.authorId,
  };

  const recipe = existing
    ? await db.recipe.update({ where: { id: existing.recipeId }, data })
    : await db.recipe.create({ data });

  if (!existing) {
    await db.recipeSlug.create({
      data: { slug: input.slug, recipeId: recipe.id, isCurrent: true, createdAt: input.at },
    });
  }

  await db.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
  await db.recipeIngredient.createMany({
    data: input.ingredients.map((ingredient, position) => ({
      recipeId: recipe.id,
      position,
      ...ingredient,
    })),
  });

  await db.recipeStep.deleteMany({ where: { recipeId: recipe.id } });
  await db.recipeStep.createMany({
    data: input.steps.map((text, position) => ({ recipeId: recipe.id, position, text })),
  });

  await db.recipeTag.deleteMany({ where: { recipeId: recipe.id } });
  const tags = await db.tag.findMany({ where: { slug: { in: input.tags } } });
  await db.recipeTag.createMany({
    data: tags.map((tag) => ({ recipeId: recipe.id, tagId: tag.id })),
  });
}
