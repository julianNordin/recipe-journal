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

test.describe("creating a recipe", () => {
  /** A title nothing else uses, so parallel workers and reruns do not collide. */
  const uniqueTitle = () => `Test bake ${String(Date.now())}${String(Math.random()).slice(2, 8)}`;

  test("creates a draft and lands on its editor", async ({ page }) => {
    await signIn(page);
    const title = uniqueTitle();

    await page.getByRole("link", { name: "New recipe" }).click();
    await expect(page).toHaveURL("/studio/new");

    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Summary").fill("Written by the end-to-end suite.");
    await page.getByLabel("Servings").fill("6");
    await page.getByRole("button", { name: "Create draft" }).click();

    // The action redirects to the editor rather than back to the dashboard:
    // creating a recipe is the first half of writing one.
    await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+\/edit$/);
    await expect(page.getByLabel("Title")).toHaveValue(title);
    await expect(page.getByLabel("Servings")).toHaveValue("6");
  });

  test("the new draft appears on the dashboard, under Drafts", async ({ page }) => {
    await signIn(page);
    const title = uniqueTitle();

    await page.goto("/studio/new");
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/edit$/);

    await page.goto("/studio");

    const drafts = page.getByRole("region", { name: "Drafts" });
    await expect(drafts.getByRole("link", { name: title })).toBeVisible();
    // Not published by anything on that form. Publishing is a validated
    // transition, and it does not exist yet.
    await expect(page.getByRole("region", { name: "Published" }).getByText(title)).toBeHidden();
  });

  test("refuses a hero image on a host that is not allowed", async ({ page }) => {
    await signIn(page);
    await page.goto("/studio/new");

    await page.getByLabel("Title").fill(uniqueTitle());
    // `noValidate` on the form, so the browser does not intercept: this is the
    // server's answer coming back through useActionState, which is the only
    // one that counts.
    await page.getByLabel("Hero image URL").fill("https://example.com/photo.jpg");
    await page.getByRole("button", { name: "Create draft" }).click();

    await expect(page.getByText(/Hero images must be https URLs on/)).toBeVisible();
    // Still on the form, with what was typed still in it.
    await expect(page).toHaveURL("/studio/new");
  });

  test("refuses an empty title and says so on the field", async ({ page }) => {
    await signIn(page);
    await page.goto("/studio/new");

    await page.getByLabel("Servings").fill("4");
    await page.getByRole("button", { name: "Create draft" }).click();

    // Scoped to the form. Next renders its own route announcer as a bare
    // `role="alert"` div, so an unscoped alert locator is ambiguous -- the
    // same trap the sign-in suite records.
    await expect(page.locator("form").getByRole("alert")).toContainText("That did not save");
    await expect(page.getByText("A recipe needs a title.")).toBeVisible();
    await expect(page).toHaveURL("/studio/new");
  });

  test("keeps what was typed when the server refuses it", async ({ page }) => {
    await signIn(page);
    await page.goto("/studio/new");

    await page.getByLabel("Summary").fill("Worth keeping.");
    await page.getByLabel("Servings").fill("9");
    // No title, so this will be refused.
    await page.getByRole("button", { name: "Create draft" }).click();

    // A form that empties itself on an error is a form people stop using.
    await expect(page.getByLabel("Summary")).toHaveValue("Worth keeping.");
    await expect(page.getByLabel("Servings")).toHaveValue("9");
  });
});

test.describe("editing a recipe", () => {
  test("opens the author's own draft with its values in the form", async ({ page }) => {
    await signIn(page);

    await page
      .getByRole("region", { name: "Drafts" })
      .getByRole("link", { name: "Brown butter cardamom buns" })
      .click();

    await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Brown butter cardamom buns");
    await expect(page.getByLabel("Summary")).toHaveValue("Still working out the proving time.");
    await expect(page.getByLabel("Servings")).toHaveValue("12");
    await expect(page.getByLabel("Difficulty")).toHaveValue("HARD");
  });

  test("saves a change and says so without leaving the page", async ({ page }) => {
    await signIn(page);

    // A recipe of this test's own, so a parallel worker editing the seeded one
    // cannot make this flap.
    const title = `Edit target ${String(Date.now())}${String(Math.random()).slice(2, 8)}`;
    await page.goto("/studio/new");
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/edit$/);
    const editUrl = page.url();

    await page.getByLabel("Summary").fill("Rewritten.");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("status")).toHaveText("Saved.");
    await expect(page).toHaveURL(editUrl);

    // Reloaded from the database rather than believed from the state.
    await page.reload();
    await expect(page.getByLabel("Summary")).toHaveValue("Rewritten.");
  });

  test("can empty a field that had a value", async ({ page }) => {
    await signIn(page);

    const title = `Clear target ${String(Date.now())}${String(Math.random()).slice(2, 8)}`;
    await page.goto("/studio/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Summary").fill("This will be removed.");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/edit$/);

    await page.getByLabel("Summary").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    await page.reload();
    // A form that can only ever set values cannot take one back.
    await expect(page.getByLabel("Summary")).toHaveValue("");
  });

  test("answers 404 for a recipe belonging to somebody else", async ({ page }) => {
    // Linus's published recipe, opened by Ada. The id is discoverable -- it is
    // on the public page -- so the editor must not render it.
    await signIn(page, "linus@example.com");
    await page
      .getByRole("region", { name: "Published" })
      .getByRole("link", { name: "Yellow split pea soup" })
      .click();

    /*
     * Wait for the navigation before reading the URL. `page.url()` straight
     * after a click returns the *old* one -- which made this test fetch
     * /studio, get a perfectly correct 200, and read exactly like an
     * authorization leak.
     */
    await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+\/edit$/);
    const linusEditUrl = page.url();

    await page.getByRole("button", { name: "Sign out" }).click();
    // Wait for the sign-out to land before navigating again. `signOut` starts
    // its own navigation, and a `goto` issued into it aborts with
    // net::ERR_ABORTED rather than doing anything useful.
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();

    await signIn(page);
    const response = await page.goto(linusEditUrl);

    expect(response?.status()).toBe(404);
    await expect(page.getByLabel("Title")).toBeHidden();
  });

  test("answers 404 for an id that is not a recipe at all", async ({ page }) => {
    await signIn(page);

    // Straight to Prisma this is `invalid input syntax for type uuid`, which
    // is a 500 on a page whose honest answer is 404.
    const response = await page.goto("/studio/not-a-uuid/edit");

    expect(response?.status()).toBe(404);
  });
});
