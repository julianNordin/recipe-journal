import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Driving the studio: making recipes for a test to act on, and finding the
 * right one of two forms on the editor page.
 *
 * The editor carries two independent forms with two independent Server
 * Actions, and both announce success with the same `role="status"` reading
 * "Saved." An unscoped locator matches whichever one has saved most recently,
 * or both -- the same ambiguity Next's route announcer causes for `alert`, one
 * layer down. Every helper here is scoped by the form's own submit button,
 * which is the only thing that reliably tells the two apart.
 */

/** The recipe's own fields: title, summary, servings, and the rest. */
export const fieldsForm = (page: Page): Locator =>
  page.locator("form").filter({ has: page.getByRole("button", { name: "Save changes" }) });

/** The ingredient and step lists, which save separately and on purpose. */
export const listsForm = (page: Page): Locator =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save ingredients and method" }) });

/**
 * The publish control and everything it says.
 *
 * A named landmark rather than a container selector, and it earns the name:
 * Next renders its own route announcer as a bare `role="alert"` div, so an
 * unscoped alert locator on this page is ambiguous and resolves to the page
 * title. The same trap the sign-in and studio suites both record.
 */
export const publishPanel = (page: Page): Locator =>
  page.getByRole("region", { name: "Publishing" });

/**
 * A draft belonging to whoever this page is signed in as, and its editor URL.
 *
 * Every test that writes gets its own recipe. The suite runs fully parallel
 * and the seeded fixtures are read by other specs, so editing those would make
 * unrelated tests flap for reasons that have nothing to do with what they
 * assert.
 */
export async function newDraft(
  page: Page,
  label: string,
): Promise<{ title: string; editUrl: string }> {
  const title = `${label} ${String(Date.now())}${String(Math.random()).slice(2, 8)}`;

  await page.goto("/studio/new");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+\/edit$/);

  return { title, editUrl: page.url() };
}

/**
 * A draft with everything `publishProblems` asks for, saved.
 *
 * Both forms, because the publish rules read the *stored* counts: a step typed
 * into the list editor and never saved does not exist as far as publishing is
 * concerned, which is correct and is the reason this helper submits twice.
 */
export async function publishableDraft(
  page: Page,
  label: string,
): Promise<{ title: string; editUrl: string }> {
  const draft = await newDraft(page, label);

  await page.getByLabel("Summary").fill("Complete enough to publish.");
  await page.getByLabel("Introduction").fill("An introduction, which publishing requires.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(fieldsForm(page).getByRole("status")).toHaveText("Saved.");

  await page.getByRole("button", { name: "Add ingredient" }).click();
  await page.getByLabel("Ingredient 1", { exact: true }).fill("flour");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Step 1", { exact: true }).fill("Mix it.");
  await page.getByRole("button", { name: "Save ingredients and method" }).click();
  await expect(listsForm(page).getByRole("status")).toHaveText("Saved.");

  return draft;
}
