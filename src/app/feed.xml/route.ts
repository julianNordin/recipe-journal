import { renderFeed } from "@/domain/feed";
import { db } from "@/server/db";
import { listPublishedRecipes } from "@/server/recipes/queries";
import { siteUrl, SITE_ORIGIN } from "@/server/site";

/**
 * `GET /feed.xml` -- the RSS feed.
 *
 * Four lines of fetching around `renderFeed`, which is pure and where the
 * escaping lives. That split is the point: a title containing `&` makes an
 * unescaped document unparseable for every reader, and that behaviour deserves
 * a unit test rather than a fixture with an ampersand in it.
 *
 * Published recipes only, from the same query the index uses, so the feed
 * cannot disagree with the site about what is public. `MAX_PAGE_SIZE` bounds
 * it at 50 by construction; a feed is the most recent things, not an archive,
 * and a reader that wants everything has the site.
 */
const FEED_SIZE = 20;

export async function GET(): Promise<Response> {
  const { items } = await listPublishedRecipes(db, { skip: 0, take: FEED_SIZE, sort: "newest" });

  const xml = renderFeed({
    title: "Recipe Journal",
    description: "Recipes, newest first.",
    siteUrl: SITE_ORIGIN,
    feedUrl: siteUrl("/feed.xml"),
    // The newest item's date, not the moment this ran. A `lastBuildDate` that
    // moves on every request tells a reader the feed changed when it did not.
    updatedAt: items[0]?.publishedAt ?? new Date(0),
    items: items.map((recipe) => ({
      title: recipe.title,
      summary: recipe.summary,
      url: siteUrl(`/recipes/${recipe.slug}`),
      publishedAt: recipe.publishedAt,
    })),
  });

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
