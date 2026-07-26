import type { MetadataRoute } from "next";

import { siteUrl } from "@/server/site";

/**
 * What a crawler is asked not to fetch.
 *
 * **A request, not a control**, and the distinction is the same one `proxy.ts`
 * carries: this file is advice to a well-behaved crawler and nothing else
 * enforces it. Everything listed here is *also* guarded on the server -- the
 * studio redirects and then authorizes, the API returns published recipes
 * only, and a draft is 404 on its public page to everybody including its
 * author. If robots.txt were the only thing keeping the studio out of an index
 * it would be keeping nothing out of anything.
 *
 * `/api/` is disallowed because it is a search endpoint, not content: a
 * crawler working through `?q=` permutations would find nothing that is not
 * already on `/recipes`, at some cost to both of us.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/studio", "/signin", "/api/"] }],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
