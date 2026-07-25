import { pageCount, resolvePaging } from "@/domain/paging";
import { parseRecipeSort, parseSearchTerm, RECIPE_SORTS } from "@/domain/recipe-sort";
import { db } from "@/server/db";
import { listPublishedRecipes } from "@/server/recipes/queries";

/**
 * `GET /api/recipes` -- the search endpoint the typeahead calls.
 *
 * **The one route handler in this application that returns data, and it exists
 * because a typeahead genuinely needs one.** Everything else here reads the
 * database inside a Server Component and renders HTML; a box that filters as
 * somebody types cannot, because there is nothing to navigate to between
 * keystrokes. That is the honest boundary for a client fetch, and it is worth
 * naming rather than letting one appear by habit.
 *
 * **It is also the third surface phase 14 asked for.** The same rule -- a draft
 * belongs to nobody but its author, and is public to no one -- has to hold on a
 * rendered page, on a Server Action and here, and only this one looks like an
 * endpoint. `listPublishedRecipes` filters on status in the `where`, so the
 * answer is the same for a stranger, for another author, and for the author
 * themselves: the query never asks who is calling, because publication is not
 * a question about the caller.
 *
 * No session is read, deliberately. There is nothing here to personalise, and
 * reading one would make a public search endpoint vary by cookie.
 */

/** HTTP shapes only. The query, the paging and the whitelist all live elsewhere. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const sort = parseRecipeSort(params.get("sort"));
  if (sort === null) {
    /*
     * 400 with the list, rather than the default order.
     *
     * A request that asked for something is answered, or told what it could
     * have asked for. Quietly substituting the default means somebody's
     * `?sort=created` returns plausible-looking results in the wrong order and
     * they have no way to find out.
     */
    return Response.json({ error: "Unknown sort", allowed: RECIPE_SORTS }, { status: 400 });
  }

  // `resolvePaging` is the only place in this application a page number is
  // parsed, and `MAX_PAGE_SIZE` is why `?pageSize=100000` is 50 rather than a
  // request to load the whole table into memory.
  const paging = resolvePaging({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  const query = parseSearchTerm(params.get("q"));
  const tagSlug = params.get("tag");

  const { items, total } = await listPublishedRecipes(db, {
    skip: paging.skip,
    take: paging.take,
    sort,
    ...(query === null ? {} : { query }),
    ...(tagSlug === null || tagSlug === "" ? {} : { tagSlug }),
  });

  return Response.json({
    items: items.map((recipe) => ({
      // A deliberately small shape: enough to draw a suggestion and follow it,
      // and nothing else. An endpoint that returns whatever the query happened
      // to select grows a contract nobody wrote down -- and this one is public.
      slug: recipe.slug,
      title: recipe.title,
      summary: recipe.summary,
      author: recipe.author.name,
    })),
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    pageCount: pageCount(total, paging.pageSize),
  });
}
