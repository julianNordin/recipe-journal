import { LinkButton } from "@/components/ui/Button";
import { Badge, Card, Container, EmptyState } from "@/components/ui/Surfaces";
import { countPublishedRecipes } from "@/server/recipes/queries";

import styles from "./page.module.css";

/**
 * An async Server Component. It awaits a database query and renders the result
 * on the server -- there is no fetch, no loading state and no client component
 * anywhere in this tree.
 *
 * Note it calls a query function rather than importing `db`. Pages compose;
 * src/server owns the data access.
 */
export default async function Home() {
  const published = await countPublishedRecipes();

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
        <Card>
          {published === 0 ? (
            <EmptyState title="Nothing published yet">
              The database is connected and answering. Recipes arrive with the authoring flow.
            </EmptyState>
          ) : (
            <p>
              {published} published {published === 1 ? "recipe" : "recipes"}.
            </p>
          )}
        </Card>
      </section>
    </Container>
  );
}
