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
