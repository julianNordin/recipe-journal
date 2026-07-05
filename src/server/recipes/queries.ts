import type { Difficulty, PrismaClient } from "@/generated/prisma/client";

/**
 * Read queries for recipes.
 *
 * This module is the only place in the application that talks to Prisma about
 * recipes. Pages compose and render; they do not write queries.
 *
 * Every function takes the client rather than importing the singleton, for one
 * concrete reason: the singleton is `server-only` and builds itself from
 * `env.DATABASE_URL`, so a test importing it would both throw under plain Node
 * and, if that were worked around, talk to the development database instead of
 * the throwaway container. Passing the client is what makes this layer
 * testable against real Postgres at all. Pages supply `db`; the database tier
 * supplies its container client.
 */

/** Published recipes only. Drafts are never counted here. */
export async function countPublishedRecipes(db: PrismaClient): Promise<number> {
  return db.recipe.count({ where: { status: "PUBLISHED" } });
}

/**
 * Everything the detail page renders, and nothing else.
 *
 * Declared as a type rather than inferred from the Prisma payload on purpose:
 * this is the contract between the data layer and the page, and it should read
 * as one. It also states in the type system that a page never sees a join row
 * or a column it has no business rendering.
 */
export type RecipeDetail = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  heroImageUrl: string | null;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: Difficulty;
  publishedAt: Date | null;
  updatedAt: Date;
  author: { id: string; name: string | null; image: string | null };
  ingredients: {
    id: string;
    quantity: string | null;
    unit: string | null;
    item: string;
    note: string | null;
  }[];
  steps: { id: string; text: string }[];
  tags: { slug: string; name: string }[];
};

/**
 * The recipe behind `/recipes/[slug]`, or null.
 *
 * **Published only, and the name says so.** Phase 14 adds an author's view of
 * their own draft; that will be a separate function taking a viewer, so that
 * no page can reach the permissive one by forgetting an argument.
 *
 * **Current slugs only.** A recipe answers at exactly one URL. An old slug
 * resolves to nothing here rather than serving the same recipe twice; Phase 15
 * gives it a 308 to the current one, which is a different question and gets a
 * different query.
 *
 * Note the explicit `select` on the author. `include: { author: true }` would
 * be shorter and would hand the whole user row -- password hash, email address
 * -- to a component that renders into a page. There is a database test
 * asserting those fields are absent, because the shorter spelling is the one
 * somebody reaches for later.
 */
export async function findPublishedRecipeBySlug(
  db: PrismaClient,
  slug: string,
): Promise<RecipeDetail | null> {
  const recipe = await db.recipe.findFirst({
    where: {
      status: "PUBLISHED",
      slugs: { some: { slug, isCurrent: true } },
    },
    select: {
      id: true,
      title: true,
      summary: true,
      body: true,
      heroImageUrl: true,
      servings: true,
      prepMinutes: true,
      cookMinutes: true,
      difficulty: true,
      publishedAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, image: true } },
      ingredients: {
        orderBy: { position: "asc" },
        select: { id: true, quantity: true, unit: true, item: true, note: true },
      },
      steps: {
        orderBy: { position: "asc" },
        select: { id: true, text: true },
      },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });

  if (recipe === null) return null;

  return {
    ...recipe,
    // We matched on `isCurrent`, so the slug we were handed *is* the current
    // one. No second lookup, and no array to unwrap defensively.
    slug,
    // Flattened here so the page never writes `tags[0].tag.name`. Shaping the
    // join away is this layer's job; a template is the wrong place to learn
    // that the relation is many-to-many.
    tags: recipe.tags.map(({ tag }) => tag),
  };
}
