import { RecipeCard } from "@/components/recipes/RecipeCard";
import { db } from "@/server/db";
import { listOtherRecipesByAuthor } from "@/server/recipes/queries";

import styles from "./MoreFromAuthor.module.css";

/**
 * Other recipes by the cook whose recipe you are reading.
 *
 * **An async Server Component with its own query, rendered inside a
 * `<Suspense>` boundary on the detail page** -- the one thing on that page a
 * reader can do without. That is the whole basis for putting it behind a
 * boundary: the shell, the ingredients and the method are in the first flush,
 * and this arrives when it arrives.
 *
 * Phase 08 learned the other half of this the expensive way. A root
 * `loading.tsx` is a boundary around *every* page, and with scripting off it
 * left every page a permanent skeleton: Next sends the fallback first and
 * streams the real content into a hidden container that inline scripts move
 * into place. Nothing moved. The recipe was in the HTML and invisible on the
 * screen, on a site whose entire claim is that the server renders the page.
 *
 * So a boundary goes around what a reader can lose, and nothing else. If this
 * section never appears for somebody with JavaScript off, they have missed a
 * suggestion. If the method never appears, they have missed the recipe.
 *
 * Renders nothing at all when the cook has written nothing else, rather than a
 * heading over an empty space.
 */
export async function MoreFromAuthor({
  authorId,
  authorName,
  excludeRecipeId,
}: {
  authorId: string;
  authorName: string | null;
  excludeRecipeId: string;
}) {
  const recipes = await listOtherRecipesByAuthor(db, { authorId, excludeRecipeId, take: 3 });

  if (recipes.length === 0) return null;

  return (
    <section className={styles.more} aria-labelledby="more-from-author">
      <h2 id="more-from-author" className={styles.heading}>
        More from {authorName ?? "this cook"}
      </h2>

      <ul className={styles.grid}>
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <RecipeCard recipe={recipe} />
          </li>
        ))}
      </ul>
    </section>
  );
}
