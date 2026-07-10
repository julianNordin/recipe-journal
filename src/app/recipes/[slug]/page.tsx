import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Badge, Container } from "@/components/ui/Surfaces";
import { formatLongDay } from "@/domain/format-date";
import { renderMarkdown, toPlainText } from "@/domain/markdown";
import { readingTime } from "@/domain/reading-time";
import type { Difficulty } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { findPublishedRecipeBySlug, listPublishedRecipeSlugs } from "@/server/recipes/queries";

import styles from "./page.module.css";

/**
 * The first real Server Component: it awaits a database query and renders the
 * result to HTML on the server. No fetch, no client-side data layer, no
 * loading state -- the page either has its data or it is not sent.
 *
 * It still imports no Prisma. `src/server` owns queries; this file composes
 * and renders what one returns.
 */

/**
 * `generateMetadata` and the page body both need the recipe, and Next calls
 * them separately. React's `cache` dedupes the two calls within one request,
 * so this is one query per page view rather than two.
 */
const getRecipe = cache((slug: string) => findPublishedRecipeBySlug(db, slug));

/**
 * Prerender the recipes that exist at build time.
 *
 * Published ones only, so a draft is never written into the build output. The
 * route stays open: a slug not in this list still renders on demand, which is
 * what keeps a recipe published after the build reachable at all.
 *
 * **It is also where Phase 16's lesson starts.** These pages are now rendered
 * once, at build, and nothing here tells Next when a recipe changes -- so an
 * edit will not appear until something revalidates. That is the bug that phase
 * is meant to show before fixing, and this is the line that creates it.
 */
export async function generateStaticParams() {
  const slugs = await listPublishedRecipeSlugs(db);
  return slugs.map((slug) => ({ slug }));
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: "Easy",
  MEDIUM: "Medium",
  HARD: "Hard",
};

/** Meta descriptions are cut off around 160 characters by most search engines. */
function truncate(text: string, limit = 155): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit).trimEnd()}…`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export async function generateMetadata(props: PageProps<"/recipes/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const recipe = await getRecipe(slug);

  // A missing recipe still gets a title -- the page below renders the 404 UI,
  // and this is what names the tab while it does.
  if (recipe === null) return { title: "Recipe not found" };

  // Every published recipe has a summary -- the publish rules require one --
  // but the column is nullable for drafts, so the body is the fallback rather
  // than an assertion.
  const description = recipe.summary ?? truncate(toPlainText(recipe.body));

  return {
    title: recipe.title,
    description,
    openGraph: {
      title: recipe.title,
      description,
      type: "article",
      publishedTime: recipe.publishedAt?.toISOString(),
      authors: recipe.author.name ? [recipe.author.name] : undefined,
    },
  };
}

export default async function RecipePage(props: PageProps<"/recipes/[slug]">) {
  // `params` is a Promise in Next 16. Reading `.slug` off the unawaited object
  // yields undefined, which reads as "no such recipe" rather than as a bug.
  const { slug } = await props.params;
  const recipe = await getRecipe(slug);

  if (recipe === null) notFound();

  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
  const reading = readingTime(recipe.body);

  return (
    <Container>
      <article className={styles.recipe}>
        <header className={styles.header}>
          <h1 className={styles.title}>{recipe.title}</h1>

          {recipe.summary ? <p className={styles.summary}>{recipe.summary}</p> : null}

          <p className={styles.byline}>
            {recipe.author.name ?? "Unknown cook"}
            {recipe.publishedAt ? (
              <>
                {" · "}
                <time dateTime={recipe.publishedAt.toISOString()}>
                  {formatLongDay(recipe.publishedAt)}
                </time>
              </>
            ) : null}
            {reading.minutes > 0 ? ` · ${reading.minutes} min read` : null}
          </p>

          {recipe.tags.length > 0 ? (
            <ul className={styles.tags} aria-label="Tags">
              {recipe.tags.map((tag) => (
                <li key={tag.slug}>
                  <Badge>{tag.name}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        {/* A description list, not a row of divs: each of these is a term and
            a value, and a screen reader should be able to say so. */}
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Serves</dt>
            <dd>{recipe.servings}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Prep</dt>
            <dd>{formatMinutes(recipe.prepMinutes)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Cook</dt>
            <dd>{formatMinutes(recipe.cookMinutes)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Total</dt>
            <dd>{formatMinutes(totalMinutes)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Difficulty</dt>
            <dd>{DIFFICULTY_LABEL[recipe.difficulty]}</dd>
          </div>
        </dl>

        {/* Author-written markdown, rendered to HTML on the server.
            `dangerouslySetInnerHTML` is safe here for exactly one reason:
            renderMarkdown sanitises. It is the only sanctioned use of it in
            this codebase, and src/domain/markdown.ts carries the argument. */}
        <div
          className={styles.body}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.body) }}
        />

        <div className={styles.columns}>
          <section className={styles.ingredients} aria-labelledby="ingredients">
            <h2 id="ingredients">Ingredients</h2>
            {recipe.ingredients.length === 0 ? (
              <p className={styles.none}>No ingredients listed.</p>
            ) : (
              <ul className={styles.ingredientList}>
                {recipe.ingredients.map((ingredient) => (
                  <li key={ingredient.id}>
                    {ingredient.quantity ? (
                      <span className={styles.amount}>
                        {ingredient.quantity}
                        {ingredient.unit ? ` ${ingredient.unit}` : null}
                      </span>
                    ) : null}{" "}
                    {ingredient.item}
                    {ingredient.note ? (
                      <span className={styles.note}> ({ingredient.note})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.method} aria-labelledby="method">
            <h2 id="method">Method</h2>
            {recipe.steps.length === 0 ? (
              <p className={styles.none}>No steps listed.</p>
            ) : (
              // An ordered list, so the numbering is the document's rather
              // than something painted on with CSS counters.
              <ol className={styles.stepList}>
                {recipe.steps.map((step) => (
                  <li key={step.id}>{step.text}</li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </article>
    </Container>
  );
}
