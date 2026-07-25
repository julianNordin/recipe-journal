import { expect, test } from "@playwright/test";

/**
 * Searching the recipe index, in a browser.
 *
 * Two things worth a browser here, and they are the two halves of the same
 * decision: **the box is a GET form that works with no JavaScript at all**, and
 * the typeahead over it is an enhancement. The first is asserted by the no-js
 * project in `server-rendering.spec.ts`; this file drives the enhanced one.
 */

test.describe("searching", () => {
  test("filters the index, and the URL says so", async ({ page }) => {
    await page.goto("/recipes");

    await page.getByLabel("Search recipes").fill("sourdough");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/\/recipes\?.*q=sourdough/);
    await expect(page.getByRole("link", { name: "No-knead sourdough" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Yellow split pea soup" })).toBeHidden();
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/recipes?q=zzzznothing");

    await expect(page.getByText("No matches")).toBeVisible();
    await expect(page.getByText("Nothing matches")).toBeVisible();
  });

  test("suggests as you type, without submitting", async ({ page }) => {
    await page.goto("/recipes");

    await page.getByLabel("Search recipes").fill("crisp");

    // The suggestion arrives from /api/recipes after the debounce. The URL has
    // not changed, because nothing has been navigated to yet.
    await expect(page.getByRole("link", { name: /Rye crispbread/ })).toBeVisible();
    await expect(page).toHaveURL("/recipes");
  });

  test("a suggestion goes to the recipe", async ({ page }) => {
    await page.goto("/recipes");
    await page.getByLabel("Search recipes").fill("crisp");

    await page.getByRole("link", { name: /Rye crispbread/ }).click();

    await expect(page).toHaveURL("/recipes/rye-crispbread");
    await expect(page.getByRole("heading", { level: 1, name: "Rye crispbread" })).toBeVisible();
  });

  test("never suggests a draft", async ({ page }) => {
    await page.goto("/recipes");

    await page.getByLabel("Search recipes").fill("cardamom");

    // The endpoint filters on status, so there is nothing to suggest. Asserted
    // here as well as at the endpoint because this is the surface somebody
    // would actually notice it on.
    await expect(page.getByText("Brown butter cardamom buns")).toHaveCount(0);
  });

  test("re-orders without losing the search", async ({ page }) => {
    await page.goto("/recipes?q=e");

    await page.getByLabel("Order").selectOption("title");
    await page.getByRole("button", { name: "Search" }).click();

    // Both parameters survive. A sort control that dropped the search would
    // look like the search resetting itself.
    await expect(page).toHaveURL(/q=e/);
    await expect(page).toHaveURL(/sort=title/);
  });
});
