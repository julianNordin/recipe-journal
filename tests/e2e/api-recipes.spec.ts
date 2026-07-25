import { expect, test } from "@playwright/test";

import { signedInAs } from "./support/authors";

/**
 * `GET /api/recipes`, the search endpoint.
 *
 * **This is the third of the three surfaces phase 14 asked for**, and the only
 * one that looks like an endpoint. The same rule has to hold on a rendered
 * page, on a Server Action and here; the obligation was written into
 * `authorization.spec.ts` when the other two were done, and this is it being
 * discharged.
 *
 * The paging assertions are the ones the pre-ship verification gate names:
 * `?pageSize=100000` clamps, and `?sort=id` is a 400 that says what was
 * allowed rather than quietly serving the default order.
 */

type Listing = {
  items: { slug: string; title: string; summary: string | null; author: string | null }[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

const DRAFT = "Brown butter cardamom buns";

test.describe("the recipes endpoint", () => {
  test("returns published recipes", async ({ request }) => {
    /*
     * `sort=oldest`, so the seeded fixtures are on the first page whatever
     * else the suite has published while this ran. Sorted newest-first this
     * asserted against whichever recipe another spec had just created, and
     * failed the first time the two ran together.
     */
    const body = (await (await request.get("/api/recipes?sort=oldest")).json()) as Listing;

    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.map((r) => r.title)).toContain("No-knead sourdough");
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
  });

  test("searches titles and summaries", async ({ request }) => {
    const body = (await (await request.get("/api/recipes?q=sourdough")).json()) as Listing;

    expect(body.items.map((r) => r.title)).toEqual(["No-knead sourdough"]);
    expect(body.total).toBe(1);
  });

  test("filters by tag", async ({ request }) => {
    const body = (await (await request.get("/api/recipes?tag=soup")).json()) as Listing;

    expect(body.items.map((r) => r.title)).toEqual(["Yellow split pea soup"]);
  });

  test("never returns a draft, to anyone", async ({ request, browser }) => {
    /*
     * **Phase 14's rule, on its third surface.** A signed-out stranger, an
     * author who is not the draft's, and its own author all get the same
     * answer -- because the query filters on status in the `where` and never
     * asks who is calling. Publication is not a question about the caller,
     * which is exactly why this endpoint reads no session at all.
     */
    const anonymous = (await (await request.get(`/api/recipes?q=cardamom`)).json()) as Listing;
    expect(anonymous.items).toEqual([]);

    for (const author of ["ada", "linus"] as const) {
      const context = await browser.newContext({ storageState: await signedInAs(browser, author) });
      try {
        const body = (await (
          await context.request.get("/api/recipes?q=cardamom")
        ).json()) as Listing;

        expect(body.items, `${author} could see the draft`).toEqual([]);
        expect(JSON.stringify(body)).not.toContain(DRAFT);
      } finally {
        await context.close();
      }
    }
  });

  test("clamps an absurd page size", async ({ request }) => {
    const response = await request.get("/api/recipes?pageSize=100000");
    const body = (await response.json()) as Listing;

    // MAX_PAGE_SIZE, from the one module that parses a page number. Without
    // the clamp this is a request to load the whole table into memory, from
    // anybody, as many times as they like.
    expect(response.status()).toBe(200);
    expect(body.pageSize).toBe(50);
  });

  test("refuses an unknown sort and says what is allowed", async ({ request }) => {
    const response = await request.get("/api/recipes?sort=id");

    expect(response.status()).toBe(400);

    const body = (await response.json()) as { error: string; allowed: string[] };
    expect(body.allowed).toEqual(["newest", "oldest", "title", "quickest"]);

    // `id` is a real column, which is the point: this is a whitelist, not a
    // check that the name exists.
    expect(body.error).toContain("Unknown sort");
  });

  test("accepts every sort on the list", async ({ request }) => {
    for (const sort of ["newest", "oldest", "title", "quickest"]) {
      const response = await request.get(`/api/recipes?sort=${sort}`);

      // The control on the test above. A handler that refused everything would
      // pass that one and serve nobody.
      expect(response.status(), sort).toBe(200);
    }
  });

  test("pages, and reports enough to page with", async ({ request }) => {
    const first = (await (await request.get("/api/recipes?pageSize=1")).json()) as Listing;

    expect(first.items).toHaveLength(1);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBeGreaterThan(1);

    const second = (await (await request.get("/api/recipes?pageSize=1&page=2")).json()) as Listing;

    expect(second.page).toBe(2);
    expect(second.items[0]?.slug).not.toBe(first.items[0]?.slug);
  });

  test("returns only the fields a suggestion needs", async ({ request }) => {
    const body = (await (await request.get("/api/recipes?pageSize=1")).json()) as Listing;
    const item = body.items[0];

    // A public endpoint's shape is a contract. This one is four fields chosen
    // on purpose rather than whatever the query happened to select, so a
    // column added to the card query cannot quietly become part of it.
    expect(Object.keys(item ?? {}).sort()).toEqual(["author", "slug", "summary", "title"]);
  });
});
