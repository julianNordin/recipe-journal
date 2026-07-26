import type { MetadataRoute } from "next";

import { db } from "@/server/db";
import { listPublishedRecipeSlugs, listTags } from "@/server/recipes/queries";
import { siteUrl } from "@/server/site";

/**
 * The sitemap, built from what is actually published.
 *
 * **The test on this is a privacy assertion before it is an SEO one.** A
 * sitemap is a list of URLs handed to a crawler with an invitation to fetch
 * every one of them -- so a draft in here is not a slightly wrong file, it is
 * a private page submitted to a search engine by its own author. That is the
 * same rule as the detail page, the Server Action and `/api/recipes`, on a
 * fourth surface, and it is the surface where getting it wrong is hardest to
 * take back.
 *
 * It gets the rule the same way all the others do: `listPublishedRecipeSlugs`
 * is scoped in its `where`, so there is no fifth definition of "public" here
 * to drift from the other four.
 *
 * `/studio`, `/signin` and `/api` are absent because they are not content.
 * `robots.ts` says so as well, which is belt and braces on purpose -- a
 * sitemap is a suggestion and a crawler that ignored it would still find the
 * studio by following a link.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [slugs, tags] = await Promise.all([listPublishedRecipeSlugs(db), listTags(db)]);

  return [
    { url: siteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: siteUrl("/recipes"), changeFrequency: "daily", priority: 0.8 },
    { url: siteUrl("/tags"), changeFrequency: "weekly", priority: 0.5 },
    ...tags.map((tag) => ({
      url: siteUrl(`/tags/${tag.slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
    ...slugs.map((slug) => ({
      url: siteUrl(`/recipes/${slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
