import { expect, test } from "@playwright/test";

/**
 * The only honest evidence that the S in SSR is doing anything.
 *
 * Every other test in this suite would pass just as well against a client-side
 * app that fetched its data after load. These run with scripting disabled, and
 * one of them never opens a browser at all -- it reads the bytes the server
 * sent. If the recipe is in there, the server put it there.
 *
 * The detail page is the right place for this because it has the most content
 * to assert against: a title, a summary, a markdown body, an ingredient list
 * and an ordered method.
 */

const RECIPE = "/recipes/no-knead-sourdough";

/**
 * React marks text-node boundaries in server-rendered HTML, so
 * `{n} published {word}` arrives as `1<!-- --> published <!-- -->recipe`.
 * A substring assertion against the raw bytes finds nothing and looks exactly
 * like a failed query. Strip the markers before asserting on text.
 */
const stripReactMarkers = (html: string): string => html.replaceAll("<!-- -->", "");

test.describe("server rendering", () => {
  test("the whole recipe is in the HTML the server sends", async ({ request }) => {
    // No browser, no JavaScript engine, no hydration -- an HTTP GET and the
    // response body. This is the strongest form the assertion can take.
    const response = await request.get(RECIPE);
    expect(response.status()).toBe(200);

    const html = stripReactMarkers(await response.text());

    // The heading and the summary.
    expect(html).toContain("No-knead sourdough");
    expect(html).toContain("A long, slow ferment that does the work while you do not.");

    // The markdown body, rendered to HTML on the server rather than shipped as
    // markdown for the client to parse.
    expect(html).toContain("gluten develops on its own given time");
    expect(html).toContain("<p>Start it the night before.</p>");

    // Every ingredient, with its quantities and its note.
    for (const ingredient of [
      "strong white flour",
      "active starter",
      "fine salt",
      "at room temperature",
    ]) {
      expect(html, `ingredient missing: ${ingredient}`).toContain(ingredient);
    }

    // Every step, in an ordered list rather than numbers painted on by CSS.
    for (const step of [
      "Mix flour and water and rest for one hour.",
      "Shape, then refrigerate overnight.",
      "Bake at 250C covered for twenty minutes, then uncovered for twenty-five.",
    ]) {
      expect(html, `step missing: ${step}`).toContain(step);
    }
    expect(html).toContain("<ol");

    // The facts, and the author.
    expect(html).toContain("Ada");
    expect(html).toContain("Serves");
  });

  test("the page is readable with scripting switched off", async ({ page }) => {
    // The raw-bytes test proves the content is present. This proves it is
    // usable: rendered, in the right structure, with no hydration to wait for.
    await page.goto(RECIPE);

    await expect(page.getByRole("heading", { level: 1, name: "No-knead sourdough" })).toBeVisible();

    const ingredients = page.getByRole("region", { name: "Ingredients" });
    await expect(ingredients.getByRole("listitem")).toHaveCount(4);
    await expect(ingredients.getByRole("listitem").first()).toContainText("strong white flour");

    const method = page.getByRole("region", { name: "Method" });
    await expect(method.getByRole("listitem")).toHaveCount(5);
    await expect(method.getByRole("listitem").first()).toContainText("Mix flour and water");

    // Ordered, and in the order the positions say -- not insertion order.
    await expect(method.getByRole("listitem").last()).toContainText("Bake at 250C");
  });

  test("a draft is not disclosed to a visitor", async ({ request }) => {
    // Phase 14 proves this rule on all three surfaces and with a real second
    // author. Here it is only the page, and only for a signed-out visitor,
    // but the page is a surface and it should never have leaked in the first
    // place.
    const response = await request.get("/recipes/brown-butter-cardamom-buns");
    const html = stripReactMarkers(await response.text());

    expect(html).not.toContain("Brown butter cardamom buns");
    expect(html).toContain("Not found");

    // The status is 200, not 404, and that is Next's documented behaviour
    // rather than a bug here: notFound() can only set a status while the
    // response has not started, and a dynamic route streams. Next compensates
    // with a robots noindex, so the draft stays out of search results. The
    // assertion that matters is the one above -- nothing about the draft is
    // disclosed.
    expect(html).toContain('name="robots"');
    expect(html).toContain("noindex");
  });

  test("a published recipe is not marked noindex", async ({ request }) => {
    // The control for the assertion above. Without it, a build that marked
    // every page noindex would pass the draft test and quietly delist the
    // whole site.
    const html = await (await request.get(RECIPE)).text();

    expect(html).not.toContain("noindex");
  });
});
