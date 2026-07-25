import { DEFAULT_RECIPE_SORT, type RecipeSort } from "@/domain/recipe-sort";
import type { Difficulty, Prisma, PrismaClient, RecipeStatus } from "@/generated/prisma/client";

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

/*
 * There is deliberately no `countPublishedRecipes` here.
 *
 * `listPublishedRecipes` builds one `where` and hands it to both the page
 * query and the count, so its total can never describe a different filter than
 * its items. A second, standalone count is a second place for that filter to
 * be written -- and the day the two disagree, the pager says there is another
 * page and the page is empty. It existed from phase 09 to phase 15 with no
 * caller at all, which is how it survived being obviously the wrong shape.
 */

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
  commentCount: number;
};

/**
 * The columns a card needs, named once.
 *
 * Two queries feed `RecipeCard` -- the paged list and the author's other
 * recipes -- and a card that silently lost its tags on one of them would look
 * like a data problem rather than a `select` that had drifted.
 */
const RECIPE_CARD_SELECT = {
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
  /*
   * **The N+1, and its fix, in one line.**
   *
   * A card shows how many comments a recipe has. Asking per recipe -- a
   * `comment.count` for each row -- is the classic shape: measured at **7
   * operations for five recipes and 12 for ten**, which is 2 + N and grows
   * with the page size forever.
   *
   * `_count` makes it part of the same request. Prisma issues one aggregate
   * for the whole page instead of one lookup per row, so the cost stops
   * depending on how many recipes came back. `tests/db/query-count.test.ts`
   * asserts that five and ten cost the *same*, never that they cost a
   * particular number -- a test pinned to "7 queries" passes for the wrong
   * reason the day somebody adds a column.
   */
  _count: { select: { comments: true } },
} satisfies Prisma.RecipeSelect;

type CardRow = Prisma.RecipeGetPayload<{ select: typeof RECIPE_CARD_SELECT }>;

/**
 * Rows to cards, dropping any recipe that has no current slug.
 *
 * A recipe with no live slug has no URL, so a card for it would link nowhere.
 * Dropping it is the honest rendering rather than a workaround: the partial
 * unique index allows at most one current slug, it does not require one.
 * `flatMap` rather than filter-then-map, so the narrowing survives into the
 * returned type.
 */
function toCards(rows: CardRow[]): RecipeListItem[] {
  return rows.flatMap(({ slugs, tags, _count, ...recipe }) => {
    const slug = slugs[0]?.slug;
    if (slug === undefined) return [];
    return [{ ...recipe, slug, tags: tags.map(({ tag }) => tag), commentCount: _count.comments }];
  });
}

/**
 * A sort name turned into an ordering, exhaustively.
 *
 * **A `Record` over the union rather than a switch with a default**, so adding
 * a name to `RECIPE_SORTS` and forgetting it here is a type error rather than
 * a silent fall-through to "newest". That is the half of the whitelist the
 * compiler can check; `parseRecipeSort` is the half that faces the query
 * string.
 *
 * Every one of them ends in `id`, and the tiebreaker is load-bearing under
 * offset paging -- see `listPublishedRecipes`. `id` is a uuid v7, so it is
 * time-ordered and the tiebreak agrees with a date sort rather than fighting
 * it. A title sort ties on it too, which is arbitrary and *stable*, and stable
 * is the property paging needs.
 */
const ORDERINGS: Record<RecipeSort, Prisma.RecipeOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: "desc" }, { id: "desc" }],
  oldest: [{ publishedAt: "asc" }, { id: "asc" }],
  title: [{ title: "asc" }, { id: "asc" }],
  quickest: [{ cookMinutes: "asc" }, { id: "asc" }],
};

const orderingFor = (sort: RecipeSort): Prisma.RecipeOrderByWithRelationInput[] => ORDERINGS[sort];

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
  options: { skip: number; take: number; tagSlug?: string; query?: string; sort?: RecipeSort },
): Promise<RecipePage> {
  // One `where`, used by both the page query and the count, so the total can
  // never describe a different filter than the items.
  const where: Prisma.RecipeWhereInput = {
    status: "PUBLISHED",
    ...(options.tagSlug === undefined
      ? {}
      : { tags: { some: { tag: { slug: options.tagSlug } } } }),
    /*
     * Search is a contains-match over the title and the summary, and the body
     * is deliberately not in it. A recipe body mentions flour; matching on it
     * would return every bread recipe for a search for `flour` and there would
     * be no way to say "the ones that are about flour".
     *
     * `mode: "insensitive"` is `ILIKE`, and the leading wildcard is why the
     * trigram indexes exist -- a B-tree has no prefix to seek on and would scan
     * every published row.
     */
    ...(options.query === undefined
      ? {}
      : {
          OR: [
            { title: { contains: options.query, mode: "insensitive" } },
            { summary: { contains: options.query, mode: "insensitive" } },
          ],
        }),
  };

  const [rows, total] = await Promise.all([
    db.recipe.findMany({
      where,
      orderBy: orderingFor(options.sort ?? DEFAULT_RECIPE_SORT),
      skip: options.skip,
      take: options.take,
      select: {
        ...RECIPE_CARD_SELECT,
      },
    }),
    db.recipe.count({ where }),
  ]);

  return {
    items: toCards(rows),
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

/* --- The studio ---------------------------------------------------------- */

/** One row of an author's dashboard. */
export type AuthoredRecipeListItem = {
  id: string;
  title: string;
  summary: string | null;
  status: RecipeStatus;
  /** Null for a recipe that has no current slug. See the note below. */
  slug: string | null;
  updatedAt: Date;
  publishedAt: Date | null;
};

/**
 * Everything one author has written, drafts included, newest edit first.
 *
 * **Scoped by author in the query, not filtered afterwards.** The dashboard is
 * the one page in this application where a draft is deliberately visible, so
 * it is the one place where `authorId` is doing real work rather than
 * repeating what `status` already decided. Fetching everything and filtering
 * in the page would put that decision somewhere a `select` cannot enforce it.
 *
 * **A recipe with no current slug is still listed**, which is the opposite of
 * what `listPublishedRecipes` does with one. That function drops it because a
 * public card would link nowhere; the studio links by id, so dropping it here
 * would make the recipe permanently unreachable by the only person who could
 * give it a slug back.
 *
 * The sort has a tiebreaker for the reason the public listing does: an order
 * that is not total can differ between two identical requests. `id` is a uuid
 * v7, so it agrees with the intent of the sort instead of fighting it.
 */
export async function listRecipesByAuthor(
  db: PrismaClient,
  authorId: string,
): Promise<AuthoredRecipeListItem[]> {
  const rows = await db.recipe.findMany({
    where: { authorId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      summary: true,
      status: true,
      updatedAt: true,
      publishedAt: true,
      slugs: { where: { isCurrent: true }, select: { slug: true } },
    },
  });

  return rows.map(({ slugs, ...recipe }) => ({ ...recipe, slug: slugs[0]?.slug ?? null }));
}

/**
 * A uuid, as Postgres would accept one.
 *
 * The id comes out of a URL, so it is whatever somebody typed. Handing
 * `/studio/nonsense/edit` straight to Prisma raises `invalid input syntax for
 * type uuid` from the driver -- a 500 on a page whose honest answer is 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything the studio's form needs to render an existing recipe. */
export type AuthoredRecipe = {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  heroImageUrl: string | null;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: Difficulty;
  status: RecipeStatus;
  slug: string | null;

  /**
   * Ordered, and carrying their row ids.
   *
   * The editor's reducer addresses rows by a stable key rather than by index,
   * so anything already saved needs an identity that survives a reorder. The
   * row's own id is it.
   */
  ingredients: {
    id: string;
    position: number;
    quantity: string | null;
    unit: string | null;
    item: string;
    note: string | null;
  }[];
  steps: { id: string; position: number; text: string }[];
};

/**
 * One recipe, if it belongs to this author.
 *
 * **Scoped in the `where`, not checked afterwards.** A recipe that does not
 * exist and a recipe belonging to somebody else return the same `null`, on
 * purpose and for the same reason `requireRecipeAuthor` raises the same error
 * for both: telling them apart lets a stranger probe for which ids are real.
 * The page turns that null into a 404.
 *
 * This is the *read* half of the studio's authorization, and it is worth being
 * clear that it is only that half. It decides what the editor renders. It has
 * nothing to say about what a Server Action does with an id somebody posted --
 * see `src/app/studio/actions.ts`.
 */
export async function findAuthoredRecipe(
  db: PrismaClient,
  params: { id: string; authorId: string },
): Promise<AuthoredRecipe | null> {
  if (!UUID.test(params.id)) return null;

  const recipe = await db.recipe.findFirst({
    where: { id: params.id, authorId: params.authorId },
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
      status: true,
      slugs: { where: { isCurrent: true }, select: { slug: true } },
      ingredients: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, quantity: true, unit: true, item: true, note: true },
      },
      steps: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, text: true },
      },
    },
  });

  if (recipe === null) return null;

  const { slugs, ...rest } = recipe;
  return { ...rest, slug: slugs[0]?.slug ?? null };
}

/**
 * Who wrote a recipe, or null if there is no such recipe.
 *
 * **The read behind `requireRecipeAuthor`**, and it lives here rather than in
 * `src/server/session.ts` for the reason at the top of this file: a function
 * that reaches for the singleton itself cannot be tested against real
 * Postgres, and this one is the whole factual content of an authorization
 * decision. Taking the client is what lets `tests/db/recipe-ownership.test.ts`
 * ask it the awkward questions directly.
 *
 * The id is whatever somebody posted, so a string that is not a uuid at all is
 * an ordinary case rather than an exceptional one. Handed straight to Prisma
 * it is `invalid input syntax for type uuid` from Postgres -- an unhandled
 * error where the honest answer is "no". The same guard `findAuthoredRecipe`
 * carries, and for the same reason.
 *
 * A recipe that is absent and a recipe belonging to somebody else are not
 * distinguished by the caller, so nothing here needs to hide the difference;
 * the caller does. See `requireRecipeAuthor`.
 */
export async function findRecipeAuthorId(db: PrismaClient, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;

  const recipe = await db.recipe.findUnique({ where: { id }, select: { authorId: true } });
  return recipe?.authorId ?? null;
}

/**
 * The address a superseded slug should lead to, if it should lead anywhere.
 *
 * `recipe_slugs` keeps every slug a recipe has ever held, so a URL that worked
 * before a rename still finds a row -- it just is not the live one. This turns
 * that row into the slug that is, and the detail page turns *that* into a
 * permanent redirect.
 *
 * **Published recipes only, and that is the interesting half.** Redirecting to
 * a page that then answers 404 is worse than answering 404 here: it costs the
 * reader a round trip and it tells a stranger that a draft with that former
 * name exists, which is precisely what the draft rules spend their time not
 * saying. So an old slug of an unpublished recipe is treated exactly like a
 * slug that never existed.
 *
 * Returns null for the live slug too. A redirect from a page to itself is a
 * loop, and the caller reaches this only after the live lookup has missed --
 * but relying on the caller's order for that would be a trap for whoever calls
 * it second.
 */
export async function findCurrentSlugFor(db: PrismaClient, slug: string): Promise<string | null> {
  const row = await db.recipeSlug.findUnique({
    where: { slug },
    select: {
      isCurrent: true,
      recipe: {
        select: {
          status: true,
          slugs: { where: { isCurrent: true }, select: { slug: true } },
        },
      },
    },
  });

  if (row === null || row.isCurrent) return null;
  if (row.recipe.status !== "PUBLISHED") return null;

  return row.recipe.slugs[0]?.slug ?? null;
}

/**
 * The address a recipe answers at right now, or null if it has none.
 *
 * For the actions that change a recipe without touching its title: they know
 * an id and have to invalidate a path. `moveCurrentSlug` hands its own callers
 * both addresses directly, so this is only for the ones that never asked it
 * anything.
 */
export async function findCurrentSlug(db: PrismaClient, recipeId: string): Promise<string | null> {
  const row = await db.recipeSlug.findFirst({
    where: { recipeId, isCurrent: true },
    select: { slug: true },
  });

  return row?.slug ?? null;
}

/**
 * Other published recipes by the same cook, newest first.
 *
 * The one query on the detail page that is not the recipe, which is what makes
 * it the right thing to put behind a Suspense boundary: the page is complete
 * without it. Phase 08 learned the other version of that lesson the expensive
 * way -- a boundary around *everything* left the whole page a skeleton with
 * scripting off (gotcha 54) -- so the rule this encodes is that a boundary
 * goes around what a reader can do without, and nothing else.
 *
 * Excludes the recipe being read, or the page recommends itself.
 */
export async function listOtherRecipesByAuthor(
  db: PrismaClient,
  params: { authorId: string; excludeRecipeId: string; take: number },
): Promise<RecipeListItem[]> {
  const rows = await db.recipe.findMany({
    where: {
      status: "PUBLISHED",
      authorId: params.authorId,
      id: { not: params.excludeRecipeId },
    },
    // The same sort as the listing, tiebreaker included, for the same reason.
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: params.take,
    select: RECIPE_CARD_SELECT,
  });

  return toCards(rows);
}
