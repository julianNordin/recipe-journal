import type { Difficulty, Prisma, PrismaClient } from "@/generated/prisma/client";

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

/** What a recipe card shows. Deliberately without the body. */
export type RecipeListItem = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  difficulty: Difficulty;
  prepMinutes: number;
  cookMinutes: number;
  publishedAt: Date | null;
  author: { name: string | null };
  tags: { slug: string; name: string }[];
};

export type RecipePage = {
  items: RecipeListItem[];
  /** The size of the whole filtered set, not of this page. */
  total: number;
};

/**
 * A page of published recipes, newest first, optionally filtered to one tag.
 *
 * **The sort has a tiebreaker and it is load-bearing.** Ordering by
 * `publishedAt` alone leaves recipes published in the same instant in an order
 * nothing guarantees, and offset paging asks a separate question per page -- so
 * an order that changes between the questions shows one recipe twice and never
 * shows another. `id` breaks the tie, and it is a uuid v7, so it is
 * time-ordered and the tiebreak agrees with the intent of the sort rather than
 * fighting it.
 *
 * Not a theoretical worry: with the tiebreaker removed, the database test that
 * edits a recipe between page views returns `["Tie A", "Tie C", "Tie A"]` --
 * one recipe twice, one never. An UPDATE writes a new tuple at the end of the
 * heap, which is enough to reorder the next scan.
 *
 * `total` is counted, not derived from `items.length`, because the pager needs
 * to know a second page exists while looking at the first.
 */
export async function listPublishedRecipes(
  db: PrismaClient,
  options: { skip: number; take: number; tagSlug?: string },
): Promise<RecipePage> {
  // One `where`, used by both the page query and the count, so the total can
  // never describe a different filter than the items.
  const where: Prisma.RecipeWhereInput = {
    status: "PUBLISHED",
    ...(options.tagSlug === undefined
      ? {}
      : { tags: { some: { tag: { slug: options.tagSlug } } } }),
  };

  const [rows, total] = await Promise.all([
    db.recipe.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: options.skip,
      take: options.take,
      select: {
        id: true,
        title: true,
        summary: true,
        difficulty: true,
        prepMinutes: true,
        cookMinutes: true,
        publishedAt: true,
        author: { select: { name: true } },
        slugs: { where: { isCurrent: true }, select: { slug: true } },
        tags: { select: { tag: { select: { slug: true, name: true } } } },
      },
    }),
    db.recipe.count({ where }),
  ]);

  return {
    items: rows.flatMap(({ slugs, tags, ...recipe }) => {
      const slug = slugs[0]?.slug;
      // A recipe with no current slug has no URL, so a card for it would link
      // nowhere. Dropping it is the honest rendering, not a workaround: the
      // partial unique index allows at most one current slug, it does not
      // require one. `flatMap` rather than a filter-then-map so the narrowing
      // survives into the returned type.
      if (slug === undefined) return [];
      return [{ ...recipe, slug, tags: tags.map(({ tag }) => tag) }];
    }),
    total,
  };
}

/**
 * Tags that at least one published recipe carries, with their counts.
 *
 * A tag used only by drafts is left out entirely. Listing it would offer a
 * link to an empty page, and would quietly disclose that an unpublished recipe
 * exists under that name.
 */
export async function listTags(
  db: PrismaClient,
): Promise<{ slug: string; name: string; recipeCount: number }[]> {
  const tags = await db.tag.findMany({
    where: { recipes: { some: { recipe: { status: "PUBLISHED" } } } },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      _count: { select: { recipes: { where: { recipe: { status: "PUBLISHED" } } } } },
    },
  });

  return tags.map(({ slug, name, _count }) => ({ slug, name, recipeCount: _count.recipes }));
}

/**
 * The current slug of every published recipe.
 *
 * For `generateStaticParams`. Slugs only -- prerendering needs the parameter,
 * not the recipe, and each page fetches its own content anyway.
 */
export async function listPublishedRecipeSlugs(db: PrismaClient): Promise<string[]> {
  const rows = await db.recipeSlug.findMany({
    where: { isCurrent: true, recipe: { status: "PUBLISHED" } },
    select: { slug: true },
    orderBy: { slug: "asc" },
  });

  return rows.map((row) => row.slug);
}

export async function findTagBySlug(
  db: PrismaClient,
  slug: string,
): Promise<{ slug: string; name: string } | null> {
  return db.tag.findUnique({ where: { slug }, select: { slug: true, name: true } });
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
