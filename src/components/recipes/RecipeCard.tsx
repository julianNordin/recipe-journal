import Link from "next/link";

import { Badge } from "@/components/ui/Surfaces";
import type { RecipeListItem } from "@/server/recipes/queries";

import styles from "./RecipeCard.module.css";

/**
 * One recipe in a list. Shared by `/recipes`, `/tags/[slug]` and the home page,
 * so all three agree on what a recipe looks like without any of them knowing
 * how the others render.
 *
 * A server component: there is nothing interactive here beyond links, and a
 * link needs no JavaScript.
 */
export function RecipeCard({ recipe }: { recipe: RecipeListItem }) {
  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;

  return (
    <article className={styles.card}>
      <h3 className={styles.title}>
        {/*
         * The link wraps only the title, not the whole card. A card-sized
         * anchor swallows the tag links inside it and gives a screen reader a
         * link whose name is the entire card's text.
         */}
        <Link href={`/recipes/${recipe.slug}`} className={styles.link}>
          {recipe.title}
        </Link>
      </h3>

      {recipe.summary ? <p className={styles.summary}>{recipe.summary}</p> : null}

      <p className={styles.meta}>
        {recipe.author.name ?? "Unknown cook"}
        {" · "}
        {totalMinutes} min
        {recipe.publishedAt ? (
          <>
            {" · "}
            <time dateTime={recipe.publishedAt.toISOString()}>
              {recipe.publishedAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </time>
          </>
        ) : null}
      </p>

      {recipe.tags.length > 0 ? (
        <ul className={styles.tags} aria-label={`Tags for ${recipe.title}`}>
          {recipe.tags.map((tag) => (
            <li key={tag.slug}>
              <Link href={`/tags/${tag.slug}`} className={styles.tagLink}>
                <Badge>{tag.name}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
