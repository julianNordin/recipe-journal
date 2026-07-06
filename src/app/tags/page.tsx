import type { Metadata } from "next";
import Link from "next/link";

import { Container, EmptyState } from "@/components/ui/Surfaces";
import { db } from "@/server/db";
import { listTags } from "@/server/recipes/queries";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Tags",
  description: "Browse recipes by tag.",
};

export default async function TagsPage() {
  const tags = await listTags(db);

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
