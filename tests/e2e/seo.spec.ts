import { expect, test } from "@playwright/test";

/**
 * The sitemap and robots.txt.
 *
 * **The sitemap test is a privacy assertion before it is an SEO one.** A
 * sitemap is a list of URLs handed to a crawler with an invitation to fetch
 * every one -- so a draft in it is not a slightly wrong file, it is a private
 * page submitted to a search engine by its own author, and it is the one
 * surface where the mistake is hard to take back.
 *
 * That makes this the fourth place the same rule is asserted: the detail page,
 * the Server Action, `/api/recipes`, and here.
 */

const DRAFT_SLUG = "brown-butter-cardamom-buns";

test.describe("the sitemap", () => {
  test("lists every published recipe", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();

    for (const slug of ["no-knead-sourdough", "yellow-split-pea-soup", "rye-crispbread"]) {
      expect(xml, `missing: ${slug}`).toContain(`/recipes/${slug}`);
    }

    // The control. Without it, an empty sitemap passes every assertion below.
    expect(xml).toContain("/recipes</loc>");
    expect(xml).toContain("<urlset");
  });

  test("lists no drafts", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();

    expect(xml).not.toContain(DRAFT_SLUG);
  });

  test("lists nothing that is not content", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();

    // The studio and the sign-in page are not content, and `/api` is a search
    // endpoint whose results are already on `/recipes`.
    for (const path of ["/studio", "/signin", "/api/"]) {
      expect(xml, `should not be listed: ${path}`).not.toContain(path);
    }
  });

  test("is valid XML with absolute URLs", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    const xml = await response.text();

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");

    // Relative URLs in a sitemap are ignored by every crawler that reads it,
    // silently, which is the worst way for this to be wrong.
    expect(xml).toContain("<loc>http");
  });
});

test.describe("robots.txt", () => {
  test("asks crawlers to stay out of the studio, and points at the sitemap", async ({
    request,
  }) => {
    const body = await (await request.get("/robots.txt")).text();

    expect(body).toContain("Disallow: /studio");
    expect(body).toContain("Disallow: /signin");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Sitemap: http");

    // The control: it does not disallow everything. A robots.txt that blocked
    // the whole site would pass every assertion above and delist it.
    expect(body).toContain("Allow: /");
  });
});

test.describe("the feed", () => {
  test("is served as RSS and really parses", async ({ request, page }) => {
    const response = await request.get("/feed.xml");
    const xml = await response.text();

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/rss+xml");

    /*
     * Parsed by a real XML parser rather than pattern-matched.
     *
     * The escaping is unit-tested against the awkward strings; what this adds
     * is that the document a reader would actually fetch is well-formed --
     * which is the only thing a reader checks before giving up on all of it.
     * `DOMParser` lives in the browser, so the parsing happens there; it
     * reports a failure as a `parsererror` element rather than by throwing,
     * which is the detail that makes a naive version of this pass on anything.
     */
    const problem = await page.evaluate((source: string) => {
      const document_ = new DOMParser().parseFromString(source, "application/xml");
      return document_.querySelector("parsererror")?.textContent ?? null;
    }, xml);

    expect(problem).toBeNull();
  });

  test("lists recipes with absolute links, and nothing without one", async ({ request }) => {
    const xml = await (await request.get("/feed.xml")).text();

    const links = [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((match) => match[1] ?? "");

    // At least the channel and one item. The control: an empty feed satisfies
    // "every link is absolute" without saying anything.
    expect(links.length).toBeGreaterThan(1);

    /*
     * Every one absolute, asserted over whatever is in the feed rather than
     * against a named recipe. A feed is the newest twenty, so the seeded
     * fixtures are only in it when nothing else has been published -- and this
     * suite publishes. Four tests have now been written against "the first
     * page of a listing" and had to be rewritten.
     */
    for (const link of links) {
      expect(link, link).toMatch(/^https?:\/\//);
    }
  });

  test("lists no drafts", async ({ request }) => {
    const xml = await (await request.get("/feed.xml")).text();

    // The fifth surface, and the same rule from the same query.
    expect(xml).not.toContain(DRAFT_SLUG);
    expect(xml).not.toContain("Brown butter cardamom buns");
  });
});

test.describe("the link preview image", () => {
  test("is offered in the page's metadata and really renders", async ({ request }) => {
    const html = await (await request.get("/recipes/no-knead-sourdough")).text();

    const match = /<meta property="og:image" content="([^"]+)"/.exec(html);
    expect(match, "the page offers no og:image").not.toBeNull();

    const response = await request.get(match?.[1] ?? "");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");

    // A real PNG rather than an error page with the wrong header. The first
    // eight bytes are the signature every PNG starts with.
    const bytes = await response.body();
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("shows a draft nothing a slug that never existed would not", async ({ request }) => {
    /*
     * **Byte for byte identical, which is the strongest form this assertion
     * can take.** A preview image is rendered by this server, then fetched,
     * cached and displayed by somebody else's -- to people who never came here.
     * A draft title leaking into one is not a 404 anybody can serve afterwards.
     *
     * Comparing against the never-existed case rather than reading the pixels:
     * the rule is that a draft is treated exactly like a slug that is not
     * there, and equal bytes say precisely that.
     */
    const forDraft = await request.get(`/recipes/${DRAFT_SLUG}/opengraph-image`);
    const forNothing = await request.get("/recipes/no-such-recipe-anywhere/opengraph-image");

    expect(forDraft.status()).toBe(200);
    expect(forNothing.status()).toBe(200);

    expect((await forDraft.body()).equals(await forNothing.body())).toBe(true);
  });

  test("and a published recipe's image is not the generic one", async ({ request }) => {
    // The control. Two identical images would satisfy the test above while
    // meaning the feature does nothing.
    const forRecipe = await request.get("/recipes/no-knead-sourdough/opengraph-image");
    const forNothing = await request.get("/recipes/no-such-recipe-anywhere/opengraph-image");

    expect((await forRecipe.body()).equals(await forNothing.body())).toBe(false);
  });
});
