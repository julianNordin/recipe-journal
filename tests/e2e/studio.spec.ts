import { expect, test, type Page } from "@playwright/test";

/**
 * The studio, in a browser.
 *
 * The queries underneath are covered against real Postgres and the validation
 * against a long list of malformed input. What only a browser can show is that
 * the pieces are attached to each other: the session reaches the query, the
 * query reaches the page, the form posts to a Server Action, and the action's
 * answer comes back into the form it was submitted from.
 *
 * The seeded fixture is two authors. **Ada has one draft and one published
 * recipe; Linus has one published recipe of his own**, which is what makes
 * "only your own" an assertion rather than a description.
 */

const ADA = { email: "ada@example.com", name: "Ada Lindqvist" };
const PASSWORD = "recipe-journal-demo";

async function signIn(page: Page, email = ADA.email) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/studio");
}

test.describe("the dashboard", () => {
  test("shows the author their own drafts and published recipes", async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole("heading", { name: "Studio", level: 1 })).toBeVisible();
    await expect(page.getByText(`Signed in as ${ADA.name}`)).toBeVisible();

    const drafts = page.getByRole("region", { name: "Drafts" });
    const published = page.getByRole("region", { name: "Published" });

    await expect(drafts.getByRole("link", { name: "Brown butter cardamom buns" })).toBeVisible();
    await expect(published.getByRole("link", { name: "No-knead sourdough" })).toBeVisible();
  });

  test("shows nobody else's recipes", async ({ page }) => {
    await signIn(page);

    // Linus's, and published -- so it is on the public site and still must not
    // be on Ada's dashboard. Scoped by author, not by status.
    await expect(page.getByText("Yellow split pea soup")).toBeHidden();
  });

  test("offers a published recipe a link to its public page", async ({ page }) => {
    await signIn(page);

    await page
      .getByRole("region", { name: "Published" })
      .getByRole("link", { name: "View" })
      .first()
      .click();

    await expect(page).toHaveURL("/recipes/no-knead-sourdough");
  });

  test("does not offer a draft one, because it has no public page", async ({ page }) => {
    await signIn(page);

    // A "View" link on a draft would 404 -- the draft is not publicly visible
    // and Phase 14 asserts that from the other side.
    const drafts = page.getByRole("region", { name: "Drafts" });
    await expect(drafts.getByRole("link", { name: "View" })).toHaveCount(0);
  });

  test("is reachable from the header, by name", async ({ page }) => {
    await signIn(page);
    await page.goto("/recipes");

    await page.getByRole("banner").getByRole("link", { name: ADA.name }).click();

    await expect(page).toHaveURL("/studio");
  });
});
