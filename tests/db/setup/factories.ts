import type { PrismaClient, Recipe, User } from "@/generated/prisma/client";

/**
 * Test data builders.
 *
 * Every field has a default, so a test names only what it is actually about.
 * A test that spells out fifteen columns to assert on one of them hides its
 * own subject.
 */

let counter = 0;
const next = () => ++counter;

export async function makeUser(db: PrismaClient, overrides: Partial<User> = {}): Promise<User> {
  const n = next();
  return db.user.create({
    data: {
      email: `user${n}@example.com`,
      name: `User ${n}`,
      role: "AUTHOR",
      ...overrides,
    },
  });
}

export async function makeRecipe(
  db: PrismaClient,
  options: {
    author?: User;
    slug?: string;
    ingredients?: string[];
    steps?: string[];
  } & Partial<Recipe> = {},
): Promise<Recipe> {
  const { author, slug, ingredients, steps, ...overrides } = options;
  const n = next();
  const owner = author ?? (await makeUser(db));

  const recipe = await db.recipe.create({
    data: {
      title: `Recipe ${n}`,
      summary: `Summary ${n}`,
      body: "Body.",
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 20,
      authorId: owner.id,
      ...overrides,
    },
  });

  await db.recipeSlug.create({
    data: { slug: slug ?? `recipe-${n}`, recipeId: recipe.id, isCurrent: true },
  });

  if (ingredients?.length) {
    await db.recipeIngredient.createMany({
      data: ingredients.map((item, position) => ({ recipeId: recipe.id, position, item })),
    });
  }

  if (steps?.length) {
    await db.recipeStep.createMany({
      data: steps.map((text, position) => ({ recipeId: recipe.id, position, text })),
    });
  }

  return recipe;
}

/** A published recipe, with publishedAt set so the phase 06 CHECK is satisfied. */
export async function makePublishedRecipe(
  db: PrismaClient,
  options: Parameters<typeof makeRecipe>[1] = {},
): Promise<Recipe> {
  return makeRecipe(db, {
    status: "PUBLISHED",
    publishedAt: new Date("2026-07-01T12:00:00.000Z"),
    ...options,
  });
}
