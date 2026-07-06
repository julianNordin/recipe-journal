import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Pager } from "@/components/recipes/Pager";
import { RecipeCard } from "@/components/recipes/RecipeCard";
import { Container, EmptyState } from "@/components/ui/Surfaces";
import { pageCount, resolvePaging } from "@/domain/paging";
import { db } from "@/server/db";
import { findTagBySlug, listPublishedRecipes } from "@/server/recipes/queries";

import styles from "./page.module.css";

const getTag = cache((slug: string) => findTagBySlug(db, slug));

/*
 * No `generateStaticParams` here, and that is a finding rather than an
 * omission. This page reads `searchParams` for its page number, and a route
 * that reads `searchParams` cannot be prerendered -- the build has no query
 * string to render against. Adding the export would have looked like it was
 * doing something while the build output still said "server-rendered on
 * demand" for every tag.
 *
 * It lives on `/recipes/[slug]` instead, which takes no search parameters and
 * genuinely does prerender.
 */

export async function generateMetadata(props: PageProps<"/tags/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const tag = await getTag(slug);

  if (tag === null) return { title: "Tag not found" };

  return {
    title: tag.name,
    description: `Recipes tagged ${tag.name}.`,
  };
}

export default async function TagPage(props: PageProps<"/tags/[slug]">) {
  const [{ slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const tag = await getTag(slug);

  // An unknown tag is a 404 rather than an empty list. "No recipes tagged
  // sourdoguh" reads as a real but empty tag, and hides the typo.
  if (tag === null) notFound();

  const { page, pageSize, skip, take } = resolvePaging(searchParams);
  const { items, total } = await listPublishedRecipes(db, { skip, take, tagSlug: slug });

  return (
    <Container>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Tag</p>
        <h1>{tag.name}</h1>
        <p className={styles.count}>
          {total} {total === 1 ? "recipe" : "recipes"}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState title={page > 1 ? "Nothing on this page" : `Nothing tagged ${tag.name} yet`}>
          {page > 1 ? "There are fewer pages than that." : "Published recipes will appear here."}
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

      <Pager page={page} pageCount={pageCount(total, pageSize)} basePath={`/tags/${slug}`} />
    </Container>
  );
}
