import type { Metadata } from "next";
import Link from "next/link";

import { Container, EmptyState } from "@/components/ui/Surfaces";
import { orEmptyDuringBuild } from "@/server/build";
import { db } from "@/server/db";
import { listTags } from "@/server/recipes/queries";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Tags",
  description: "Browse recipes by tag.",
};

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

export default async function TagsPage() {
  const tags = await orEmptyDuringBuild(() => listTags(db), []);

  return (
    <Container>
      <header className={styles.header}>
        <h1>Tags</h1>
      </header>

      {tags.length === 0 ? (
        <EmptyState title="No tags yet">
          Tags appear here once a published recipe carries one.
        </EmptyState>
      ) : (
        <ul className={styles.list}>
          {tags.map((tag) => (
            <li key={tag.slug}>
              <Link href={`/tags/${tag.slug}`} className={styles.tag}>
                <span className={styles.name}>{tag.name}</span>
                <span className={styles.count}>
                  {tag.recipeCount} {tag.recipeCount === 1 ? "recipe" : "recipes"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
