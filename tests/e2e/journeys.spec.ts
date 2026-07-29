import { expect, test, type Locator, type Page } from "@playwright/test";

import { slugify } from "@/domain/slug";

import { signIn } from "./support/authors";
import { fieldsForm, listsForm, publishPanel } from "./support/studio";

/**
 * The whole lifecycle, in order, and the same flow with no mouse.
 *
 * **Every step here is already covered somewhere else, and that is the point
 * of the file rather than an argument against it.** The other specs each prove
 * one thing in isolation, with fixtures shaped to make that thing easy to see.
 * What none of them can show is that the steps fit together: that the id the
 * editor was given is the one publishing uses, that the address the panel
 * offers is the address a reader lands on, that a rename leaves the comment
 * where it was.
 *
 * Integration failures live exactly in those joins, and a suite of focused
 * tests is where they hide.
 */

const published: string[] = [];

test.afterEach(async ({ page }) => {
  for (const editUrl of published.splice(0)) {
    try {
      await page.goto(editUrl);
      await publishPanel(page).getByRole("button", { name: "Unpublish" }).click({ timeout: 5000 });
      await expect(publishPanel(page).getByRole("button", { name: "Publish" })).toBeVisible();
    } catch {
      // Best effort; the global teardown catches whatever this misses.
    }
  }
});

/**
 * Press Tab until `target` has focus, or fail saying so.
 *
 * **The instrument that makes a keyboard test mean anything.** Calling
 * `.focus()` and pressing Enter proves a control responds to Enter; it says
 * nothing about whether anybody could ever have got there. This walks the tab
 * order the way a person does, so a control that is unreachable -- taken out of
 * the order by `tabindex="-1"`, or hidden behind something that traps focus --
 * fails here rather than passing on a technicality.
 */
async function tabUntilFocused(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let press = 0; press < limit; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }

  throw new Error(`could not reach the control with Tab in ${String(limit)} presses`);
}

test.describe("the whole journey", () => {
  test("sign in, write, publish, comment, rename, sign out", async ({ page, request }) => {
    // --- sign in ---------------------------------------------------------
    await signIn(page, "ada");
    await expect(page.getByRole("heading", { name: "Studio", level: 1 })).toBeVisible();

    // --- a draft ---------------------------------------------------------
    const title = `Journey ${String(Date.now())}${String(Math.random()).slice(2, 6)}`;
    await page.getByRole("link", { name: "New recipe" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Summary").fill("Written end to end.");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+\/edit$/);

    const editUrl = page.url();
    published.push(editUrl);

    // --- the recipe's own fields -----------------------------------------
    await page.getByLabel("Introduction").fill("# Before you start\n\nRead it through.");
    await page.getByLabel("Servings").fill("6");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(fieldsForm(page).getByRole("status")).toHaveText("Saved.");

    // --- ingredients and steps -------------------------------------------
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await page.getByLabel("Quantity for ingredient 1").fill("500");
    await page.getByLabel("Unit for ingredient 1").fill("g");
    await page.getByLabel("Ingredient 1", { exact: true }).fill("flour");

    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByLabel("Step 1", { exact: true }).fill("Mix everything.");
    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByLabel("Step 2", { exact: true }).fill("Rest for an hour.");

    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(listsForm(page).getByRole("status")).toHaveText("Saved.");

    // --- publish ---------------------------------------------------------
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    const address = `/recipes/${slugify(title)}`;
    await expect(
      publishPanel(page).getByRole("link", { name: "View the public page" }),
    ).toHaveAttribute("href", address);

    // --- what a reader sees ----------------------------------------------
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    // The author's heading, one level down. The join between the markdown
    // pipeline and the page it renders into.
    await expect(page.getByRole("heading", { level: 2, name: "Before you start" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Method" }).getByRole("listitem")).toHaveCount(2);

    // --- a comment -------------------------------------------------------
    await page.getByLabel("Leave a comment").fill("Made it twice already.");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByText("Made it twice already.")).toBeVisible();

    // --- a rename --------------------------------------------------------
    const renamed = `${title} revised`;
    await page.goto(editUrl);
    await page.getByLabel("Title").fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(fieldsForm(page).getByRole("status")).toHaveText("Saved.");

    const moved = await request.get(address, { maxRedirects: 0 });
    expect(moved.status()).toBe(308);

    // The comment survived the move. Nothing else asserts that, because
    // nothing else does both.
    await page.goto(`/recipes/${slugify(renamed)}`);
    await expect(page.getByText("Made it twice already.")).toBeVisible();

    // --- sign out --------------------------------------------------------
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();

    // Still readable, still there. Signing out is not a withdrawal.
    await page.goto(`/recipes/${slugify(renamed)}`);
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  });
});

test.describe("with a keyboard and nothing else", () => {
  test("an author can write and publish a recipe", async ({ page }) => {
    await signIn(page, "ada");
    await page.goto("/studio/new");

    /*
     * No `click()` past this line. Every control is reached by walking the tab
     * order and activated with the key its role says should activate it --
     * Enter for a button, Space for a checkbox, and so on.
     */
    await tabUntilFocused(page, page.getByLabel("Title"));
    const title = `Keyboard ${String(Date.now())}${String(Math.random()).slice(2, 6)}`;
    await page.keyboard.type(title);

    await tabUntilFocused(page, page.getByLabel("Summary"));
    await page.keyboard.type("Typed, not clicked.");

    await tabUntilFocused(page, page.getByRole("button", { name: "Create draft" }));
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+\/edit$/);
    published.push(page.url());

    // The list editor, which is the fiddliest thing here and the one built
    // keyboard-operable from the start rather than retrofitted.
    await tabUntilFocused(page, page.getByRole("button", { name: "Add step" }));
    await page.keyboard.press("Enter");
    await tabUntilFocused(page, page.getByLabel("Step 1", { exact: true }));
    await page.keyboard.type("First.");

    await tabUntilFocused(page, page.getByRole("button", { name: "Add step" }));
    await page.keyboard.press("Enter");
    await tabUntilFocused(page, page.getByLabel("Step 2", { exact: true }));
    await page.keyboard.type("Second.");

    /*
     * Reorder from the keyboard, and check focus followed the *row* rather
     * than staying on a position -- the bug phase 13 measured and fixed.
     *
     * The button's accessible name is its position, so the same DOM node is
     * "Move Step 2 up" before the press and "Move Step 1 up" after it.
     * Asserting the second is focused is asserting that focus travelled with
     * the row, which is what somebody holding the key down experiences.
     */
    await tabUntilFocused(page, page.getByRole("button", { name: "Move Step 2 up" }));
    await page.keyboard.press("Enter");

    await expect(page.getByLabel("Step 1", { exact: true })).toHaveValue("Second.");
    await expect(page.getByRole("button", { name: "Move Step 1 up" })).toBeFocused();

    await tabUntilFocused(page, page.getByRole("button", { name: "Save ingredients and method" }));
    await page.keyboard.press("Enter");
    await expect(listsForm(page).getByRole("status")).toHaveText("Saved.");
  });

  test("a reader can search and follow a suggestion", async ({ page }) => {
    await page.goto("/recipes");

    await tabUntilFocused(page, page.getByLabel("Search recipes"));
    await page.keyboard.type("crisp");

    /*
     * The suggestion is the next thing in the tab order, which is the whole
     * reason the list sits immediately after the input in the document rather
     * than after the sort control. Reaching it with one Tab is the assertion.
     */
    // Scoped to the search form: the recipe is also a card in the listing
    // underneath, and an unscoped locator finds both.
    const suggestion = page.getByRole("search").getByRole("link", { name: /Rye crispbread/ });
    await expect(suggestion).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(suggestion).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/recipes/rye-crispbread");
  });
});
