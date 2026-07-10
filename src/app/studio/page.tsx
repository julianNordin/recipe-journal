import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LinkButton } from "@/components/ui/Button";
import { Badge, Container, EmptyState } from "@/components/ui/Surfaces";
import { formatDay } from "@/domain/format-date";
import { signInPath } from "@/domain/safe-redirect";
import { db } from "@/server/db";
import { listRecipesByAuthor, type AuthoredRecipeListItem } from "@/server/recipes/queries";
import { getSession } from "@/server/session";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Studio",
  // Nobody's drafts belong in a search index, and the page is behind a session
  // anyway -- but a crawler that reached it would otherwise be told to index
  // whatever it was served.
  robots: { index: false, follow: false },
};

/**
 * An author's own recipes, drafts included.
 *
 * **This page checks the session itself, and that is not belt-and-braces.**
 * `src/proxy.ts` already redirects signed-out visitors away from `/studio`,
 * and a page that leaned on it would be relying on something that runs beside
 * the router rather than inside it. That is the shape of CVE-2025-29927 and
 * the reason Phase 14 exists: a proxy is an optimistic redirect for humans,
 * and every surface that needs a user asks for one.
 *
 * A redirect rather than a thrown `NotAuthenticatedError`, because "you are
 * not signed in" has an obvious answer and an error page is not it. Actions
 * throw; pages redirect.
 */
export default async function StudioPage() {
  const user = await getSession();
  if (user === null) redirect(signInPath("/studio"));

  const recipes = await listRecipesByAuthor(db, user.id);

  // Split here rather than in two queries. Which section a recipe belongs in
  // is a presentation question, and one round trip answers it.
  const drafts = recipes.filter((recipe) => recipe.status === "DRAFT");
  const published = recipes.filter((recipe) => recipe.status === "PUBLISHED");

  return (
    <Container>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Studio</h1>
          <p className={styles.who}>Signed in as {user.name ?? user.email}</p>
        </div>
        <LinkButton href="/studio/new">New recipe</LinkButton>
      </header>

      <section className={styles.section} aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className={styles.sectionTitle}>
          Drafts <span className={styles.count}>{drafts.length}</span>
        </h2>

        {drafts.length === 0 ? (
          <EmptyState title="No drafts">
            Anything you start and have not published yet will wait here.
          </EmptyState>
        ) : (
          <RecipeRows recipes={drafts} />
        )}
      </section>

      <section className={styles.section} aria-labelledby="published-heading">
        <h2 id="published-heading" className={styles.sectionTitle}>
          Published <span className={styles.count}>{published.length}</span>
        </h2>

        {published.length === 0 ? (
          <EmptyState title="Nothing published yet">
            Published recipes appear on the public site and in the feed.
          </EmptyState>
        ) : (
          <RecipeRows recipes={published} />
        )}
      </section>
    </Container>
  );
}

function RecipeRows({ recipes }: { recipes: AuthoredRecipeListItem[] }) {
  return (
    <ul className={styles.rows}>
      {recipes.map((recipe) => (
        <li key={recipe.id} className={styles.row}>
          <div className={styles.rowMain}>
            <h3 className={styles.rowTitle}>
              {/*
               * The edit page is keyed by id, not by slug. A draft may have no
               * slug at all, and an author renaming a recipe should not lose
               * the link they were about to click.
               */}
              <Link href={`/studio/${recipe.id}/edit`} className={styles.rowLink}>
                {recipe.title}
              </Link>
            </h3>
            {recipe.summary ? <p className={styles.rowSummary}>{recipe.summary}</p> : null}
          </div>

          <div className={styles.rowMeta}>
            <Badge tone={recipe.status === "PUBLISHED" ? "success" : "neutral"}>
              {recipe.status === "PUBLISHED" ? "Published" : "Draft"}
            </Badge>
            <span className={styles.edited}>
              Edited{" "}
              <time dateTime={recipe.updatedAt.toISOString()}>{formatDay(recipe.updatedAt)}</time>
            </span>
            {recipe.status === "PUBLISHED" && recipe.slug !== null ? (
              <Link href={`/recipes/${recipe.slug}`} className={styles.view}>
                View
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
