import { RecipeCard } from "@/components/recipes/RecipeCard";
import { LinkButton } from "@/components/ui/Button";
import { Badge, Card, Container, EmptyState } from "@/components/ui/Surfaces";
import { orEmptyDuringBuild } from "@/server/build";
import { db } from "@/server/db";
import { listPublishedRecipes } from "@/server/recipes/queries";

import styles from "./page.module.css";

/**
 * Re-rendered at most this often, on top of being invalidated when a recipe
 * changes.
 *
 * **On-demand revalidation is the mechanism; this is the safety net.** The
 * actions invalidate this page the moment anything on it moves, and that is
 * what the end-to-end tests assert. What a time bound adds is a way out of one
 * specific hole: a page prerendered during an image build, where the database
 * was unreachable and the answer was "nothing published yet". Without a clock,
 * that page would stand until somebody published something.
 */
export const revalidate = 300;

/** How many recipes the front page shows before sending people to the index. */
const LATEST_COUNT = 3;

/**
 * An async Server Component. It awaits a database query and renders the result
 * on the server -- there is no fetch, no loading state and no client component
 * anywhere in this tree.
 *
 * Note it hands `db` to a query function rather than writing a query. Pages
 * compose; src/server owns data access. The client is passed rather than
 * imported there so the same functions can run against a test container.
 */
export default async function Home() {
  const { items, total } = await orEmptyDuringBuild(
    () => listPublishedRecipes(db, { skip: 0, take: LATEST_COUNT }),
    { items: [], total: 0 },
  );

  return (
    <Container>
      <section className={styles.hero}>
        <Badge tone="accent">Work in progress</Badge>
        <h1>Recipe Journal</h1>
        <p className={styles.lede}>
          A small recipe site with authoring and authentication. Server Components read the database
          directly, Server Actions write through it, and there is no client-side data layer at all.
        </p>
        <div className={styles.actions}>
          <LinkButton href="/recipes" size="lg">
            Browse recipes
          </LinkButton>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="latest">
        <h2 id="latest">Latest</h2>

        {items.length === 0 ? (
          <Card>
            <EmptyState title="Nothing published yet">
              The database is connected and answering. Recipes arrive with the authoring flow.
            </EmptyState>
          </Card>
        ) : (
          <>
            <ul className={styles.grid}>
              {items.map((recipe) => (
                <li key={recipe.id}>
                  <RecipeCard recipe={recipe} />
                </li>
              ))}
            </ul>
            {total > items.length ? (
              <p className={styles.more}>
                <LinkButton href="/recipes" variant="secondary" size="sm">
                  All {total} recipes
                </LinkButton>
              </p>
            ) : null}
          </>
        )}
      </section>
    </Container>
  );
}
