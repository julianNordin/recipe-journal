import type { Metadata } from "next";

import { Pager } from "@/components/recipes/Pager";
import { RecipeCard } from "@/components/recipes/RecipeCard";
import { Container, EmptyState } from "@/components/ui/Surfaces";
import { pageCount, resolvePaging } from "@/domain/paging";
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
 * string turn into a number.
 */
export default async function RecipesPage(props: PageProps<"/recipes">) {
  const { page, pageSize, skip, take } = resolvePaging(await props.searchParams);

  const { items, total } = await listPublishedRecipes(db, { skip, take });

  return (
    <Container>
      <header className={styles.header}>
        <h1>Recipes</h1>
        <p className={styles.count}>
          {total === 0 ? "Nothing published yet" : `${total} published`}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState title={page > 1 ? "Nothing on this page" : "No recipes yet"}>
          {page > 1
            ? "There are fewer pages than that. Try the first page."
            : "Published recipes will appear here."}
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

      <Pager page={page} pageCount={pageCount(total, pageSize)} basePath="/recipes" />
    </Container>
  );
}
