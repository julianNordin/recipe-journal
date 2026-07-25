import type { Metadata } from "next";

import { Pager } from "@/components/recipes/Pager";
import { RecipeCard } from "@/components/recipes/RecipeCard";
import { RecipeSearch } from "@/components/recipes/RecipeSearch";
import { Container, EmptyState } from "@/components/ui/Surfaces";
import { pageCount, resolvePaging } from "@/domain/paging";
import { DEFAULT_RECIPE_SORT, parseRecipeSort, parseSearchTerm } from "@/domain/recipe-sort";
import { db } from "@/server/db";
import { listPublishedRecipes } from "@/server/recipes/queries";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Recipes",
  description: "Every published recipe, newest first.",
};

/**
 * The recipe index.
 *
 * `searchParams` is a Promise in Next 16, exactly like `params`. Its values
 * are whatever is in the URL, so they go straight into `resolvePaging`, which
 * is where the parsing and the clamping live -- this file never sees a raw
 * string turn into a number. The same is true of the search term and the sort:
 * every one of them is parsed by a function in `src/domain`, and the page just
 * passes what comes back.
 *
 * **Searching is navigation, so it is a URL.** The box is a GET form and the
 * result is a page that can be bookmarked and shared; the typeahead over it is
 * an enhancement. An unknown `?sort=` falls back to the default here rather
 * than 400-ing, which is the one place this differs from `/api/recipes` and is
 * deliberate: a person following a stale link should get recipes, and a client
 * calling an endpoint should be told its request was wrong.
 */
export default async function RecipesPage(props: PageProps<"/recipes">) {
  const searchParams = await props.searchParams;
  const { page, pageSize, skip, take } = resolvePaging(searchParams);

  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const query = parseSearchTerm(first(searchParams.q));
  const sort = parseRecipeSort(first(searchParams.sort)) ?? DEFAULT_RECIPE_SORT;

  const { items, total } = await listPublishedRecipes(db, {
    skip,
    take,
    sort,
    ...(query === null ? {} : { query }),
  });

  return (
    <Container>
      <header className={styles.header}>
        <h1>Recipes</h1>
        <p className={styles.count}>
          {total === 0
            ? query === null
              ? "Nothing published yet"
              : "Nothing matches"
            : `${total} ${query === null ? "published" : "matching"}`}
        </p>
      </header>

      <RecipeSearch query={query ?? ""} sort={sort} />

      {items.length === 0 ? (
        <EmptyState
          title={
            page > 1 ? "Nothing on this page" : query === null ? "No recipes yet" : "No matches"
          }
        >
          {page > 1
            ? "There are fewer pages than that. Try the first page."
            : query === null
              ? "Published recipes will appear here."
              : `Nothing published matches “${query}”. Try a shorter word.`}
        </EmptyState>
      ) : (
        <ul className={styles.grid}>
          {items.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard recipe={recipe} />
            </li>
          ))}
        </ul>
      )}

      {/*
       * The filter travels with the pager, or page two of a search is page two
       * of everything -- which looks like the search silently resetting.
       */}
      <Pager
        page={page}
        pageCount={pageCount(total, pageSize)}
        basePath="/recipes"
        searchParams={{
          ...(query === null ? {} : { q: query }),
          ...(sort === DEFAULT_RECIPE_SORT ? {} : { sort }),
        }}
      />
    </Container>
  );
}
