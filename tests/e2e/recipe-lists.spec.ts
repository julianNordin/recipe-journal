import { expect, test, type Page } from "@playwright/test";

import { newDraft, signIn } from "./support/authors";

/**
 * The ingredient and step editor, in a browser.
 *
 * The reducer's edge cases are covered in the fast tier and the payload's
 * rules against real Postgres. What only a browser can show is the part that
 * is genuinely about a browser: that a reorder survives a save, that the
 * buttons work from the keyboard alone, and that focus does not fall off the
 * row it was on -- which is the thing a reorder implementation gets wrong.
 */

async function addSteps(page: Page, texts: string[]) {
  for (const [index, text] of texts.entries()) {
    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByLabel(`Step ${String(index + 1)}`, { exact: true }).fill(text);
  }
}

const stepValues = (page: Page) =>
  page
    .locator("textarea[id^='step-']")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLTextAreaElement).value));

test.describe("the ingredient and step editor", () => {
  test("starts empty and says so", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");

    await expect(page.getByText("No ingredients yet.")).toBeVisible();
    await expect(page.getByText("No steps yet.")).toBeVisible();
  });

  test("adds, saves and reads back both lists", async ({ page }) => {
    await signIn(page);
    const { editUrl } = await newDraft(page, "Lists");

    await page.getByRole("button", { name: "Add ingredient" }).click();
    await page.getByLabel("Quantity for ingredient 1").fill("500");
    await page.getByLabel("Unit for ingredient 1").fill("g");
    await page.getByLabel("Ingredient 1", { exact: true }).fill("strong white flour");
    await addSteps(page, ["Mix the flour and water.", "Rest for one hour."]);

    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // From the database, not from the state that just claimed to have saved.
    await page.goto(editUrl);
    await expect(page.getByLabel("Ingredient 1", { exact: true })).toHaveValue(
      "strong white flour",
    );
    await expect(page.getByLabel("Quantity for ingredient 1")).toHaveValue("500");
    expect(await stepValues(page)).toEqual(["Mix the flour and water.", "Rest for one hour."]);
  });

  test("reorders a step and the new order survives a save", async ({ page }) => {
    await signIn(page);
    const { editUrl } = await newDraft(page, "Lists");
    await addSteps(page, ["first", "second", "third"]);

    await page.getByRole("button", { name: "Move Step 3 up" }).click();
    expect(await stepValues(page)).toEqual(["first", "third", "second"]);

    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto(editUrl);
    // The positions are what came back from the database, so this is the
    // assertion that the reorder was persisted rather than merely rendered.
    expect(await stepValues(page)).toEqual(["first", "third", "second"]);
  });

  test("removes a row and closes the gap", async ({ page }) => {
    await signIn(page);
    const { editUrl } = await newDraft(page, "Lists");
    await addSteps(page, ["keep", "drop", "keep too"]);

    await page.getByRole("button", { name: "Remove Step 2" }).click();
    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto(editUrl);
    expect(await stepValues(page)).toEqual(["keep", "keep too"]);
  });

  test("can empty a list that had rows in it", async ({ page }) => {
    await signIn(page);
    const { editUrl } = await newDraft(page, "Lists");
    await addSteps(page, ["only one"]);
    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto(editUrl);
    await page.getByRole("button", { name: "Remove Step 1" }).click();
    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto(editUrl);
    await expect(page.getByText("No steps yet.")).toBeVisible();
  });
});

test.describe("reordering from the keyboard alone", () => {
  test("moves a row with Enter on the button", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");
    await addSteps(page, ["first", "second", "third"]);

    // No mouse anywhere in this test. Reordering that only works by pointer is
    // the default outcome, which is why this is written now and not in Phase 20.
    await page.getByRole("button", { name: "Move Step 3 up" }).focus();
    await page.keyboard.press("Enter");

    expect(await stepValues(page)).toEqual(["first", "third", "second"]);
  });

  test("keeps focus on the button that moved the row", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");
    await addSteps(page, ["first", "second", "third"]);

    await page.getByRole("button", { name: "Move Step 3 up" }).focus();
    await page.keyboard.press("Enter");

    // The row is now second, so the button naming it has been renamed with it.
    // Nothing in the component re-focuses anything: Chromium keeps focus on a
    // node React moves, which was measured rather than assumed.
    await expect(page.getByRole("button", { name: "Move Step 2 up" })).toBeFocused();
  });

  test("a second press moves the same row again, not whatever landed there", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");
    await addSteps(page, ["a", "b", "c"]);

    /*
     * **The test that `key={row.key}` earns.** Moving *down* twice is what
     * separates a stable key from an index one, and only just: with index keys
     * React updates the rows in place rather than moving them, so focus stays
     * on a position while the row it belonged to slides out from under it --
     * and the second press reorders the row that arrived instead.
     *
     * Measured: with the key replaced by the array index this ends "a, b, c",
     * having moved one row down and then back up. Every other test in this
     * file still passes.
     */
    await page.getByRole("button", { name: "Move Step 1 down" }).focus();
    await page.keyboard.press("Enter");
    expect(await stepValues(page)).toEqual(["b", "a", "c"]);

    await page.keyboard.press("Enter");
    expect(await stepValues(page)).toEqual(["b", "c", "a"]);
  });

  test("a press at the end is a no-op that says so", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");
    await addSteps(page, ["first", "second"]);

    const up = page.getByRole("button", { name: "Move Step 1 up" });
    await up.focus();
    await page.keyboard.press("Enter");

    /*
     * The button stays enabled at the end on purpose: disabling it would take
     * the focus with it, and somebody holding the key down would be dropped on
     * the document body exactly when the row arrived first. The announcement
     * is what makes the no-op audible.
     */
    expect(await stepValues(page)).toEqual(["first", "second"]);
    await expect(up).toBeFocused();
    await expect(page.getByText("Step 1 is already first.")).toBeAttached();
  });

  test("announces where a row landed", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");
    await addSteps(page, ["first", "second", "third"]);

    await page.getByRole("button", { name: "Move Step 1 down" }).click();

    await expect(page.getByText("Moved Step 1 to position 2 of 3.")).toBeAttached();
  });
});

test.describe("what the server does with the payload", () => {
  test("refuses a row with nothing in it, naming the row", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");

    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByLabel("Step 1", { exact: true }).fill("this one is fine");
    // Step 2 left empty.

    await page.getByRole("button", { name: "Save ingredients and method" }).click();

    // Numbered from one, because that is what the row is labelled with on
    // screen. "index 1" would be findable by nobody.
    await expect(page.getByText(/Step 2:/)).toBeVisible();
  });

  test("leaves the lists on the page when it refuses them", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Lists");
    await addSteps(page, ["worth keeping"]);
    await page.getByRole("button", { name: "Add step" }).click();

    await page.getByRole("button", { name: "Save ingredients and method" }).click();
    await expect(page.getByText(/Step 2:/)).toBeVisible();

    // An editor that emptied itself on a validation error would be worse than
    // one that never saved at all.
    expect(await stepValues(page)).toEqual(["worth keeping", ""]);
  });
});
