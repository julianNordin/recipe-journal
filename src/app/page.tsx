import { LinkButton } from "@/components/ui/Button";
import { Badge, Card, Container, EmptyState } from "@/components/ui/Surfaces";

import styles from "./page.module.css";

export default function Home() {
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
          <EmptyState title="Nothing published yet">
            Recipes arrive once the database and the public pages land, in phases 03 and 08.
          </EmptyState>
        </Card>
      </section>
    </Container>
  );
}
