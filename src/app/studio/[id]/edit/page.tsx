import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RecipeForm } from "@/components/studio/RecipeForm";
import { RecipeListsEditor } from "@/components/studio/RecipeListsEditor";
import { Badge, Card, Container } from "@/components/ui/Surfaces";
import { signInPath } from "@/domain/safe-redirect";
import { db } from "@/server/db";
import { findAuthoredRecipe } from "@/server/recipes/queries";
import { getSession } from "@/server/session";

import { updateRecipeAction } from "../../actions";
import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "Edit recipe",
  robots: { index: false, follow: false },
};

/**
 * The editor for one recipe.
 *
 * **`params` is a Promise in Next 16** -- reading `props.params.id` without
 * awaiting yields `undefined` inside a template string and looks like a
 * missing route parameter rather than a missing `await`.
 *
 * The recipe is fetched scoped to the signed-in author, so somebody else's id
 * comes back null and this answers 404. That is the read half of the studio's
 * authorization and it is only the read half: what a Server Action does with
 * an id somebody posted is a separate question, asked in `../../actions.ts`.
 */
export default async function EditRecipePage(props: PageProps<"/studio/[id]/edit">) {
  const user = await getSession();
  if (user === null) redirect(signInPath("/studio"));

  const { id } = await props.params;
  const recipe = await findAuthoredRecipe(db, { id, authorId: user.id });
  if (recipe === null) notFound();

  return (
    <Container>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Edit recipe</h1>
          <p className={styles.who}>
            <Badge tone={recipe.status === "PUBLISHED" ? "success" : "neutral"}>
              {recipe.status === "PUBLISHED" ? "Published" : "Draft"}
            </Badge>{" "}
            {recipe.status === "PUBLISHED" && recipe.slug !== null ? (
              <Link href={`/recipes/${recipe.slug}`}>View the public page</Link>
            ) : (
              "Not public yet."
            )}
          </p>
        </div>
      </header>

      <div className={styles.section}>
        <Card>
          <RecipeForm
            action={updateRecipeAction}
            defaults={recipe}
            submitLabel="Save changes"
            cancelHref="/studio"
          />
        </Card>
      </div>

      {/*
       * A second form, and a second save.
       *
       * The recipe's own fields and its two ordered lists have nothing in
       * common to reconcile -- one is a flat set of values, the other a list
       * whose order is the content. One submit for both would mean a handler
       * juggling two shapes and a button that saves things the author did not
       * touch.
       */}
      <div className={styles.section}>
        <Card>
          <RecipeListsEditor
            recipeId={recipe.id}
            ingredients={recipe.ingredients}
            steps={recipe.steps}
          />
        </Card>
      </div>
    </Container>
  );
}
